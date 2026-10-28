// Dark Lime layout: keep recorder controls and IDs intact while grouping by task.
(()=>{
  const byId=id=>document.getElementById(id),settings=document.querySelector('.settings');
  const advanced=byId('preferencesBody');
  for(const id of ['micDevice','floating','delay','minimize'])advanced.append(byId(id).closest('label'));
  for(const details of [...settings.querySelectorAll('details')])advanced.append(details);
  const source=document.createElement('div');source.className='source-choice';
  const label=document.createElement('label');label.textContent='Источник записи';label.htmlFor='choose';
  const choose=byId('choose');choose.replaceChildren(byId('sourceLabel'));source.append(label,choose);
  const tools=document.createElement('div');tools.className='capture-tools';tools.append(byId('region'),byId('screenshot'));
  const region=document.createElement('div');region.className='region-info';region.append(byId('regionLabel'),byId('regionClear'));
  const formats=document.createElement('div');formats.className='format-fields';formats.append(byId('fps').closest('label'),byId('quality').closest('label'));
  const audio=document.createElement('div');audio.className='audio-fields';audio.append(byId('mic').closest('label'),byId('systemAudio').closest('label'));
  settings.replaceChildren(source,tools,region,formats,audio,document.querySelector('.meter-block'),document.querySelector('.transport'));
  byId('preferencesTab').onclick=()=>byId('preferencesDialog').showModal();
  byId('closePreferences').onclick=()=>byId('preferencesDialog').close();
  byId('previewExpand').onclick=()=>{document.querySelector('.preview-panel').classList.toggle('expanded');byId('previewExpand').setAttribute('aria-pressed',String(document.querySelector('.preview-panel').classList.contains('expanded')));};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){document.querySelector('.preview-panel').classList.remove('expanded');byId('previewExpand').setAttribute('aria-pressed','false');}});
})();
