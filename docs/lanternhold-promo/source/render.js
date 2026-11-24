const {chromium}=require('playwright');
const S={square:[1080,1080],portrait:[1080,1350],story:[1080,1920],wide:[1200,630]};
(async()=>{const b=await chromium.launch();
for(const [f,[w,h]] of Object.entries(S)){const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
await p.goto('file://'+__dirname+'/ad.html?f='+f);await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(300);
await p.screenshot({path:__dirname+'/out-'+f+'.png'});await p.close();}
await b.close();})();
