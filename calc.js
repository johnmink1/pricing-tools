function $(id){return document.getElementById(id)}
function num(id){var v=parseFloat($(id).value);return isNaN(v)?0:v}
function money(x){return '$'+(Math.round(x*100)/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
function bind(fn){document.querySelectorAll('input,select').forEach(function(e){e.addEventListener('input',fn)});fn()}