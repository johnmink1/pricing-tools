function $(id){return document.getElementById(id)}
function num(id){var v=parseFloat($(id).value);return isNaN(v)?0:v}
function money(x){if(!isFinite(x))return'-';return(x<0?'-$':'$')+Math.abs(x).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
function money0(x){if(!isFinite(x))return'-';return(x<0?'-$':'$')+Math.round(Math.abs(x)).toLocaleString('en-US')}
function bind(fn){document.querySelectorAll('input,select').forEach(function(e){e.addEventListener('input',fn)});fn()}
