(function(){"use strict";let e=null;self.onmessage=l=>{e&&(clearInterval(e),e=null);const t=l.data?.interval;typeof t=="number"&&t>0&&(e=setInterval(()=>self.postMessage(1),t))}})();
