'use strict';
async function lockRunViewport(wc,viewport,bounds){
  wc.runViewport=viewport;
  if(bounds)wc.runPresentation=bounds;
  if(!wc.debugger.isAttached())wc.debugger.attach('1.3');
  wc.setZoomFactor(1);
  const area=wc.runPresentation;
  // Only width determines presentation scale. A bottom panel clips the view;
  // it must not shrink the entire website when opened.
  const scale=area?area.width/viewport.width:1;
  const metrics={width:Math.round(viewport.width),height:Math.round(viewport.height),deviceScaleFactor:0,mobile:false,scale};
  const key=JSON.stringify(metrics);if(wc.runMetricsKey===key)return;
  await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride',metrics);wc.runMetricsKey=key;
}
module.exports={lockRunViewport};
