for(const id of ['pause','stop','screenshot','show','hide'])document.getElementById(id).onclick=()=>window.panel.command(id);
window.panel.onState(s=>{document.getElementById('time').textContent=new Date(s.elapsed*1000).toISOString().slice(11,19);document.getElementById('pause').textContent=s.state==='paused'?'▶':'Пауза';document.getElementById('level').value=s.level;});
