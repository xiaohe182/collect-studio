// Resize DOM panels and the native browser together; coalesce pointer updates per frame.
(()=>{
  const sidebar=$('sidebar'),tree=$('flowTree');
  let width=Number(localStorage.getItem('sidebarWidth'))||360;
  let height=Number(localStorage.getItem('flowHeight'))||0;
  let frame=0;
  function applyWidth(value){
    width=Math.max(360,Math.min(value,720,innerWidth-320));
    document.documentElement.style.setProperty('--sidebar-width',width+'px');
    cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>cmd('sidebar-resize',{width}));
  }
  function applyHeight(value){
    const max=Math.max(100,sidebar.clientHeight-220);
    height=Math.max(100,Math.min(value,max));
    tree.style.height=height+'px';tree.style.maxHeight='none';tree.style.flex='0 0 auto';
  }
  function wire(id,axis,change,current){
    const handle=$(id);let drag=null;
    handle.onpointerdown=e=>{
      if(e.button!==0)return;e.preventDefault();handle.setPointerCapture(e.pointerId);
      drag={x:e.clientX,y:e.clientY,value:current()};
      document.body.classList.add('resizing');cmd('panel-dialog',{open:true});
    };
    document.addEventListener('pointermove',e=>{if(!drag)return;change(drag.value+(axis==='x'?drag.x-e.clientX:e.clientY-drag.y));});
    function finish(){if(!drag)return;drag=null;document.body.classList.remove('resizing');localStorage.setItem('sidebarWidth',width);if(height)localStorage.setItem('flowHeight',height);cmd('panel-dialog',{open:!!document.querySelector('dialog[open]')});syncRunPage();}
    document.addEventListener('pointerup',finish);document.addEventListener('pointercancel',finish);handle.onlostpointercapture=finish;
    handle.onkeydown=e=>{const delta=axis==='x'?({ArrowLeft:20,ArrowRight:-20}[e.key]):({ArrowUp:-20,ArrowDown:20}[e.key]);if(delta){e.preventDefault();change(current()+delta);localStorage.setItem('sidebarWidth',width);if(height)localStorage.setItem('flowHeight',height);}};
  }
  wire('sidebarResize','x',applyWidth,()=>width);
  wire('settingsResize','y',applyHeight,()=>tree.getBoundingClientRect().height);
  applyWidth(width);if(height)applyHeight(height);
  window.addEventListener('resize',()=>{applyWidth(width);if(height)applyHeight(height);});
})();
