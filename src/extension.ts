import * as vscode from "vscode";
import * as fs from "fs";

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    "csvJsonTable.open",
    (uri: vscode.Uri) => {
      const panel = vscode.window.createWebviewPanel(
        "csvTable",
        "CSV Config Table",
        vscode.ViewColumn.One,
        { enableScripts: true },
      );

      let filePath = uri.fsPath;
      let csvContent = fs.readFileSync(filePath, "utf8");
      panel.webview.html = getWebviewContent(csvContent, filePath);

      panel.webview.onDidReceiveMessage((message) => {
        if (message.command === "save") {
          fs.writeFileSync(filePath, message.data);
          vscode.window.showInformationMessage("CSV saved");

          // Reload the file content back into the Webview
          const latestCsv = fs.readFileSync(filePath, "utf8");
          panel.webview.postMessage({ command: "reload", data: latestCsv });
        }
      });
    },
  );

  context.subscriptions.push(disposable);
}

function getWebviewContent(csvData: string, filePath: string): string {
  const escapedCsv = csvData.replace(/`/g, "\\`");

  return `
<!DOCTYPE html>
<html>
<head>
<script src="https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.js"></script>
<style>
body{font-family:sans-serif;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);margin:0;}
#title{padding:8px;border-bottom:1px solid var(--vscode-editorWidget-border);}
table{border-collapse:collapse;width:100%;}
thead th{position:sticky;top:0;z-index:5;background:var(--vscode-editorWidget-background);}
th,td{border:1px solid var(--vscode-editorWidget-border);padding:6px;white-space:nowrap;}
th{position:relative; cursor:pointer; user-select:none;}
.resize-handle{position:absolute; top:0; right:0; width:6px; height:100%; cursor:col-resize;}
.filter-row td{background:var(--vscode-editor-background); position:static; z-index:1;}
.filter-input{width:100%;border:1px solid var(--vscode-input-border);background:var(--vscode-input-background);color:var(--vscode-input-foreground);}
td:hover{background:var(--vscode-list-hoverBackground);}
.selected{outline:2px solid var(--vscode-focusBorder);}
input.cellEdit{width:100%;border:none;background:var(--vscode-input-background);color:var(--vscode-input-foreground);}
#editorOverlay{display:none;position:fixed;inset:0; z-index:1000; background:rgba(0,0,0,0.45);}
#editorBox{position:absolute;top:8%;left:8%;width:84%;height:80%;background:var(--vscode-editor-background);border:1px solid var(--vscode-editorWidget-border);display:flex;flex-direction:column;}
#editorHeader{padding:8px;font-weight:bold;border-bottom:1px solid var(--vscode-editorWidget-border);}
#monacoEditor{flex:1;}
</style>
</head>
<body>
<div id="title">CSV Config Table</div>
<div id="table"></div>
<div id="editorOverlay">
  <div id="editorBox">
    <div id="editorHeader">JSON Editor (Ctrl/Cmd + Enter to Save)</div>
    <div id="monacoEditor"></div>
  </div>
</div>

<script>
const vscode = acquireVsCodeApi();
let isDirty=false, inlineEditing=false;

let header=[], rows=[], filteredRows=[];
let selectedRow=0, selectedCol=0;
let editingRow=null, editingCol=null;
let editor;
const jsonColumns=new Set();
const columnFilters={};
let sortState={column:null,direction:null};

function initialize(csv){
  const parsed = Papa.parse(csv.trim());
  header.splice(0, header.length, ...parsed.data[0]);
  rows = parsed.data.slice(1);
  filteredRows = [...rows];
  detectJsonColumns();
  pipeline();
}

function detectJsonColumns(){
  jsonColumns.clear();
  rows.forEach(row=>{
    row.forEach((cell,i)=>{
      if(typeof cell!=="string") return;
      const t=cell.trim();
      if(t.startsWith("{")||t.startsWith("[")){
        try{JSON.parse(t); jsonColumns.add(i);}catch{}
      }
    });
  });
}

function escapeHtml(text){return String(text).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function jsonPreview(cell){
  try{const obj=JSON.parse(cell); const keys=Object.keys(obj).slice(0,3); return "📦 {"+keys.join(",")+"}";}
  catch{return "📦 JSON";}
}

// --- Pipeline ---
function applyFilters(){
  filteredRows = rows.filter(row=>{
    for(const col in columnFilters){
      const val = columnFilters[col];
      if(!val) continue;
      if(!String(row[col]).toLowerCase().includes(val.toLowerCase())) return false;
    }
    return true;
  });
}
function applySort(){
  if(sortState.column===null) return;
  const col = sortState.column;
  filteredRows.sort((a,b)=>{
    let A=a[col], B=b[col];
    if(!isNaN(A)&&!isNaN(B)){A=Number(A); B=Number(B);}
    if(A<B) return sortState.direction==="asc"?-1:1;
    if(A>B) return sortState.direction==="asc"?1:-1;
    return 0;
  });
}
function pipeline(){
  applyFilters();
  applySort();
  selectedRow=Math.min(selectedRow, filteredRows.length-1);
  render();
}

// --- Render ---
function render(){
  let html="<table>";
  html+="<thead><tr>";
  header.forEach((h,i)=>{
    let indicator="";
    if(sortState.column===i) indicator=sortState.direction==="asc"?" ▲":sortState.direction==="desc"?" ▼":"";
    html+="<th data-col='"+i+"'>"+escapeHtml(h)+indicator+"<div class='resize-handle' data-col='"+i+"'></div></th>";
  });
  html+="</tr><tr class='filter-row'>";
  header.forEach((h,i)=>{
    if(jsonColumns.has(i)){html+="<td></td>";}
    else{const val=columnFilters[i]||""; html+="<td><input class='filter-input' data-col='"+i+"' value='"+escapeHtml(val)+"'></td>";}
  });
  html+="</tr></thead><tbody>";
  filteredRows.forEach((row,r)=>{
    html+="<tr>";
    row.forEach((cell,c)=>{
      let display = cell;
      if(jsonColumns.has(c)) display = jsonPreview(cell);
      const sel = (r===selectedRow && c===selectedCol)?"selected":"";
      html+="<td class='"+sel+"' data-row='"+r+"' data-col='"+c+"'>"+escapeHtml(display)+"</td>";
    });
    html+="</tr>";
  });
  html+="</tbody></table>";
  document.getElementById("table").innerHTML = html;
  bindEvents();
}

// --- Events ---
function bindEvents(){
  document.querySelectorAll("td").forEach(cell=>{
    cell.onclick=()=>{if(inlineEditing) return; selectedRow=parseInt(cell.dataset.row); selectedCol=parseInt(cell.dataset.col); updateSelection();}
    cell.ondblclick=()=>{selectedRow=parseInt(cell.dataset.row); selectedCol=parseInt(cell.dataset.col); editCell(selectedRow,selectedCol);}
  });

  document.querySelectorAll("th").forEach(th=>{
    th.onclick=(e)=>{
      if(e.target.classList.contains("resize-handle")) return;
      const col=parseInt(th.dataset.col);
      if(sortState.column!==col){sortState.column=col; sortState.direction="asc";}
      else if(sortState.direction==="asc"){sortState.direction="desc";}
      else{sortState.column=null; sortState.direction=null;}
      pipeline();
    };
  });

  document.querySelectorAll(".filter-input").forEach(input=>{
    const col=parseInt(input.dataset.col);
    input.addEventListener("keydown",(e)=>{
      e.stopPropagation();
      if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key)) return;
      if(e.key==="Enter"){columnFilters[col]=input.value; pipeline(); input.blur();}
      if(e.key==="Escape"){input.value=columnFilters[col]||""; input.blur();}
    });
    input.addEventListener("blur",()=>{columnFilters[col]=input.value; pipeline();});
  });

  enableColumnResize();
}

// --- Selection ---
function updateSelection(){
  document.querySelectorAll(".selected").forEach(c=>c.classList.remove("selected"));
  const newCell=document.querySelector("td[data-row='"+selectedRow+"'][data-col='"+selectedCol+"']");
  if(newCell) newCell.classList.add("selected");
}

// --- Inline Editing ---
function editCell(r,c){editingRow=r; editingCol=c; if(jsonColumns.has(c)) openJsonEditor(); else setTimeout(()=>inlineEdit(r,c),0);}
function inlineEdit(r,c){
  if(inlineEditing) return;
  inlineEditing=true;
  const cell=document.querySelector("td[data-row='"+r+"'][data-col='"+c+"']");
  const oldValue=filteredRows[r][c];
  cell.innerHTML="<input class='cellEdit'>";
  const input=cell.querySelector("input");
  input.value=oldValue;
  input.focus(); input.select();
  function commit(){
    filteredRows[r][c]=input.value;
    const realIndex=rows.indexOf(filteredRows[r]);
    if(realIndex!==-1){rows[realIndex][c]=input.value;}
    inlineEditing=false; isDirty=true; pipeline();
  }
  function cancel(){inlineEditing=false; render();}
  input.addEventListener("keydown",(e)=>{
    e.stopPropagation();
    if(e.key==="Enter"){e.preventDefault(); commit();}
    if(e.key==="Escape"){e.preventDefault(); cancel();}
  });
  input.addEventListener("blur",()=>{if(inlineEditing) commit();});
}

// --- JSON Editor ---
function openJsonEditor(){
  let value=filteredRows[editingRow][editingCol];
  try{value=JSON.stringify(JSON.parse(value),null,2);}catch{}
  document.getElementById("editorOverlay").style.display="block";
  setTimeout(()=>{
    if(!editor){
      require.config({paths:{vs:"https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs"}});
      require(["vs/editor/editor.main"],function(){
        editor=monaco.editor.create(document.getElementById("monacoEditor"),{
          value:value,
          language:"json",
          theme:"vs-dark",
          automaticLayout:true,
          minimap:{enabled:false}
        });
      });
    }else{editor.setValue(value);}
  },50);
}
function closeEditor(){document.getElementById("editorOverlay").style.display="none";}
function applyJsonEdit(){
  try{
    const parsed=JSON.parse(editor.getValue());
    const valStr=JSON.stringify(parsed);
    filteredRows[editingRow][editingCol]=valStr;
    const realIndex=rows.indexOf(filteredRows[editingRow]);
    if(realIndex!==-1){rows[realIndex][editingCol]=valStr;}
    isDirty=true; closeEditor(); pipeline(); return true;
  }catch(e){
    monaco.editor.setModelMarkers(editor.getModel(), "owner", [{
      startLineNumber: e.lineNumber || 1,
      startColumn: e.columnNumber || 1,
      endLineNumber: e.lineNumber || 1,
      endColumn: e.columnNumber || 1,
      message: e.message,
      severity: monaco.MarkerSeverity.Error
    }]);
    return false;
  }
}

// --- Global Keydown ---
document.addEventListener("keydown",(e)=>{
  if(document.getElementById("editorOverlay").style.display==="block"){
    if(e.key==="Escape"){e.preventDefault(); closeEditor();}
    if(e.key==="Enter"&&(e.metaKey||e.ctrlKey)){e.preventDefault(); applyJsonEdit();}
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="s"){e.preventDefault(); save();}
    return;
  }
  if(inlineEditing) return;
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="s"){e.preventDefault(); save(); return;}
  switch(e.key){
    case "ArrowUp": selectedRow=Math.max(0,selectedRow-1); break;
    case "ArrowDown": selectedRow=Math.min(filteredRows.length-1,selectedRow+1); break;
    case "ArrowLeft": selectedCol=Math.max(0,selectedCol-1); break;
    case "ArrowRight": selectedCol=Math.min(header.length-1,selectedCol+1); break;
    case "Enter": e.preventDefault(); editCell(selectedRow, selectedCol); break;
  }
  updateSelection();
});

// --- Save ---
function save(){
  if(document.getElementById("editorOverlay").style.display==="block"){
    const ok=applyJsonEdit();
    if(!ok) return;
  }
  const finalData=[header,...rows];
  const newCsv=Papa.unparse(finalData);
  vscode.postMessage({command:"save",data:newCsv});
  isDirty=false;
}

// --- Column Resize ---
function enableColumnResize(){
  document.querySelectorAll(".resize-handle").forEach(handle=>{
    let startX,startWidth,th;
    handle.addEventListener("mousedown",(e)=>{
      e.stopPropagation();
      th=handle.parentElement; startX=e.pageX; startWidth=th.offsetWidth;
      document.onmousemove=(e2)=>{th.style.width=startWidth+(e2.pageX-startX)+"px";}
      document.onmouseup=()=>{document.onmousemove=null; document.onmouseup=null;}
    });
  });
}

// --- Listen for reload message from extension ---
window.addEventListener("message", event=>{
  const msg = event.data;
  if(msg.command==="reload"){initialize(msg.data);}
});

// --- Initialize ---
initialize(\`${escapedCsv}\`);
</script>
</body>
</html>
`;
}

export function deactivate() {}
