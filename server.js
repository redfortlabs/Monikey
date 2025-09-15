const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(process.cwd(), 'fixtures');
const server = http.createServer((req,res)=>{
  const p = req.url === '/' ? '/testpage.html' : req.url;
  const f = path.join(root, p);
  fs.readFile(f, (err, data)=>{
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {'Content-Type': f.endsWith('.html')?'text/html':'text/plain'});
    res.end(data);
  });
});
server.listen(8080, ()=> console.log('Serving fixtures on http://localhost:8080/'));
