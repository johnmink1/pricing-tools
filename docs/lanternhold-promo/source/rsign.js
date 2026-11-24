const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1500,height:2100}});
await p.goto('file://'+__dirname+'/sign.html');await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(300);
await p.screenshot({path:__dirname+'/sign.png'});await p.pdf({path:__dirname+'/sign.pdf',width:'5in',height:'7in',printBackground:true,pageRanges:'1'});await b.close();})();
