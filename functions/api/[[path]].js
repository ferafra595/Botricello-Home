const J=(obj,status=200,headers={})=>new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const bad=(msg,status=400)=>J({error:msg},status);
const parse=async request=>{try{return await request.json()}catch{return {}}};
const dateOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const toDay=x=>Math.floor(Date.parse(x+'T00:00:00Z')/86400000);
const diff=(a,b)=>toDay(b)-toDay(a);
const addDay=(d,n)=>new Date((toDay(d)+n)*86400000).toISOString().slice(0,10);
const overlap=(a,b,c,d)=>a<d&&b>c;
const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const equal=(a,b)=>{if(a.length!==b.length)return false;let r=0;for(let i=0;i<a.length;i++)r|=a.charCodeAt(i)^b.charCodeAt(i);return r===0};
const pbkdf=async (password,salt)=>{let key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);let bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:100000},key,256);return [...new Uint8Array(bits)].map(v=>v.toString(16).padStart(2,'0')).join('')};
async function settings(DB){const r=await DB.prepare("SELECT value FROM settings WHERE key='site'").first();return r?JSON.parse(r.value):{}}
async function pricing(DB,start,end,guests){if(!dateOK(start)||!dateOK(end)||diff(start,end)<1||diff(start,end)>90||!Number.isInteger(guests)||guests<1||guests>4)throw Error('Controlla date (1-90 notti) e ospiti (1-4)');
 const [rates,overrides,discounts,blocks,confirmed]=await Promise.all([DB.prepare('SELECT * FROM rates').all(),DB.prepare('SELECT * FROM overrides ORDER BY rowid ASC').all(),DB.prepare('SELECT * FROM discounts WHERE active=1 ORDER BY min_nights DESC').all(),DB.prepare('SELECT * FROM blocks WHERE start_date < ? AND end_date > ?').bind(end,start).all(),DB.prepare("SELECT start_date,end_date FROM requests WHERE status='confirmed' AND start_date < ? AND end_date > ?").bind(end,start).all()]);
 if(blocks.results.length||confirmed.results.length)throw Error('Le date selezionate non sono disponibili');
 let total=0;const rmap=Object.fromEntries(rates.results.map(x=>[x.month,x.price]));for(let d=start;d<end;d=addDay(d,1)){const month=Number(d.slice(5,7));let amount=rmap[month];for(const o of overrides.results)if(d>=o.start_date&&d<=o.end_date)amount=o.price;total+=amount||0}
 const nights=diff(start,end),chosen=discounts.results.find(d=>nights>=d.min_nights),pct=chosen?chosen.pct:0;return {nights,subtotal:total,discountPct:pct,discountAmount:Math.round(total*pct/100),total:total-Math.round(total*pct/100),cleaningIncluded:true,guests,start,end};}
async function auth(ctx){const cookie=ctx.request.headers.get('Cookie')||'';const token=(cookie.match(/(?:^|;\s*)bh_session=([a-f0-9]{64})(?:;|$)/)||[])[1];if(!token)return false;const hash=await sha(token);const row=await ctx.env.DB.prepare('SELECT expires_at FROM sessions WHERE token_hash=?').bind(hash).first();return !!row&&row.expires_at>Date.now()}
function originOK(req){const origin=req.headers.get('Origin');return !!origin&&origin===new URL(req.url).origin}
const secured={ 'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'" };
export async function onRequest(ctx){const {request,env}=ctx;const DB=env.DB;if(!DB)return bad('Database D1 non configurato',503);const url=new URL(request.url);const sub=url.pathname.slice(5).replace(/^\/+|\/+$/g,'');const method=request.method;
 try{
 if(method==='GET'&&sub==='photo'){const id=url.searchParams.get('id')||'';if(!/^[a-f0-9-]{36}$/.test(id))return bad('Foto non trovata',404);const row=await DB.prepare('SELECT mime,data FROM photos WHERE id=?').bind(id).first();if(!row)return bad('Foto non trovata',404);const bytes=Uint8Array.from(atob(row.data),c=>c.charCodeAt(0));return new Response(bytes,{headers:{'Content-Type':row.mime,'Cache-Control':'public,max-age=3600','X-Content-Type-Options':'nosniff'}})}
 if(method==='GET'&&sub==='public'){const [site,rates,discounts,blocked,reservations]=await Promise.all([settings(DB),DB.prepare('SELECT * FROM rates ORDER BY month').all(),DB.prepare('SELECT min_nights,pct FROM discounts WHERE active=1 ORDER BY min_nights').all(),DB.prepare('SELECT start_date,end_date FROM blocks').all(),DB.prepare("SELECT start_date,end_date FROM requests WHERE status='confirmed'").all()]);return J({site,rates:rates.results,discounts:discounts.results,busy:[...blocked.results,...reservations.results]})}
 if(method==='POST'&&sub==='quote'){const b=await parse(request);return J(await pricing(DB,b.start,b.end,Number(b.guests)))}
 if(method==='POST'&&sub==='request'){
  if(!originOK(request))return bad('Origine non valida',403);
  const b=await parse(request);if(b.website)return bad('Richiesta non valida');
  if(typeof b.name!=='string'||b.name.trim().length<2||b.name.length>90||typeof b.phone!=='string'||!/^\+?[\d\s()\-]{7,22}$/.test(b.phone)||b.email&&(!/^\S+@\S+\.\S+$/.test(b.email)||b.email.length>150)||b.consent!==true)return bad('Compila nome, telefono e consenso privacy');
  const q=await pricing(DB,b.start,b.end,Number(b.guests));if(q.total<1)return bad('Prezzo non configurato');
  const id='BH-'+crypto.randomUUID().slice(0,8).toUpperCase();await DB.prepare('INSERT INTO requests(id,name,phone,email,start_date,end_date,guests,nights,price,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,b.name.trim(),b.phone.trim(),(b.email||'').trim(),q.start,q.end,q.guests,q.nights,q.total,'pending',new Date().toISOString()).run();
  const site=await settings(DB);return J({id,quote:q,whatsapp:site.whatsapp},201);
 }
 if(method==='POST'&&sub==='login'){
  if(!originOK(request))return bad('Origine non valida',403);if(!env.ADMIN_PASSWORD||!env.ADMIN_SALT)return bad('Configura i segreti ADMIN_PASSWORD e ADMIN_SALT',503);
  const ip=request.headers.get('CF-Connecting-IP')||'local';const k=await sha(ip+'-login');const now=Date.now();let attempt=await DB.prepare('SELECT count,reset_at FROM login_attempts WHERE id=?').bind(k).first();let count=attempt&&attempt.reset_at>now?attempt.count:0;if(count>=8)return bad('Troppi tentativi: riprova più tardi',429);
  const b=await parse(request);const candidate=typeof b.password==='string'?b.password:'';const valid=candidate.length>0&&equal(await pbkdf(candidate,env.ADMIN_SALT),await pbkdf(env.ADMIN_PASSWORD,env.ADMIN_SALT));
  if(!valid){await DB.prepare('INSERT INTO login_attempts(id,count,reset_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET count=excluded.count,reset_at=excluded.reset_at').bind(k,count+1,now+15*60000).run();return bad('Password errata',401)}
  await DB.prepare('DELETE FROM login_attempts WHERE id=?').bind(k).run();let token=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(v=>v.toString(16).padStart(2,'0')).join('');await DB.prepare('INSERT INTO sessions(token_hash,expires_at) VALUES(?,?)').bind(await sha(token),now+8*3600000).run();return J({ok:true},200,{'Set-Cookie':`bh_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=28800`});
 }
 if(sub==='session'&&method==='GET')return J({loggedIn:await auth(ctx)});
 if(!(await auth(ctx)))return bad('Accesso richiesto',401);
 if(method!=='GET'&&!originOK(request))return bad('Origine non valida',403);
 if(sub==='logout'&&method==='POST'){const token=((request.headers.get('Cookie')||'').match(/bh_session=([a-f0-9]{64})/)||[])[1];if(token)await DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha(token)).run();return J({ok:true},200,{'Set-Cookie':'bh_session=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0'})}
 if(sub==='admin'&&method==='GET'){const [site,rates,overrides,discounts,requests,blocks,payments,photos]=await Promise.all([settings(DB),DB.prepare('SELECT * FROM rates ORDER BY month').all(),DB.prepare('SELECT * FROM overrides ORDER BY start_date').all(),DB.prepare('SELECT * FROM discounts ORDER BY min_nights').all(),DB.prepare('SELECT * FROM requests ORDER BY created_at DESC LIMIT 500').all(),DB.prepare('SELECT * FROM blocks ORDER BY start_date').all(),DB.prepare('SELECT * FROM payments ORDER BY created_at DESC').all(),DB.prepare('SELECT id,created_at FROM photos ORDER BY created_at DESC').all()]);return J({site,rates:rates.results,overrides:overrides.results,discounts:discounts.results,requests:requests.results,blocks:blocks.results,payments:payments.results,photos:photos.results})}
 const b=method==='POST'?await parse(request):{};
 if(sub==='settings'&&method==='POST'){const old=await settings(DB);const allowed=['name','whatsapp','checkin','checkout','heroTitleIt','heroTitleEn','descriptionIt','descriptionEn','gallery'];for(const k of allowed)if(Object.hasOwn(b,k)){if(k==='gallery'){if(!Array.isArray(b[k])||b[k].length>12||b[k].some(v=>typeof v!=='string'||v.length>500||!(/^(https:\/\/|\/api\/photo\?id=[a-f0-9-]{36}$)/.test(v))))return bad('URL immagini non valide')}else if(typeof b[k]!=='string'||b[k].length>1200)return bad('Valore non valido: '+k);old[k]=b[k]}await DB.prepare("UPDATE settings SET value=? WHERE key='site'").bind(JSON.stringify(old)).run();return J({ok:true})}
 if(sub==='rates'&&method==='POST'){if(!Number.isInteger(b.month)||b.month<1||b.month>12||!Number.isInteger(b.price)||b.price<1||b.price>10000)return bad('Tariffa non valida');await DB.prepare('UPDATE rates SET price=? WHERE month=?').bind(b.price,b.month).run();return J({ok:true})}
 if(sub==='overrides'&&method==='POST'){if(!dateOK(b.start)||!dateOK(b.end)||b.end<b.start||!Number.isInteger(b.price)||b.price<1||b.price>10000)return bad('Periodo o prezzo non valido');const id=crypto.randomUUID();await DB.prepare('INSERT INTO overrides(id,start_date,end_date,price) VALUES(?,?,?,?)').bind(id,b.start,b.end,b.price).run();return J({ok:true,id})}
 if(sub==='overrides/delete'&&method==='POST'){await DB.prepare('DELETE FROM overrides WHERE id=?').bind(String(b.id||'')).run();return J({ok:true})}
 if(sub==='discounts'&&method==='POST'){if(!Number.isInteger(b.min_nights)||b.min_nights<2||b.min_nights>90||!Number.isInteger(b.pct)||b.pct<0||b.pct>80)return bad('Sconto non valido');const id=crypto.randomUUID();await DB.prepare('INSERT INTO discounts(id,min_nights,pct,active) VALUES(?,?,?,1)').bind(id,b.min_nights,b.pct).run();return J({ok:true})}
 if(sub==='discounts/delete'&&method==='POST'){await DB.prepare('DELETE FROM discounts WHERE id=?').bind(String(b.id||'')).run();return J({ok:true})}
 if(sub==='blocks'&&method==='POST'){if(!dateOK(b.start)||!dateOK(b.end)||b.end<=b.start||diff(b.start,b.end)>366)return bad('Date non valide');const busy=await DB.prepare('SELECT 1 FROM reserved_nights WHERE day>=? AND day<? LIMIT 1').bind(b.start,b.end).first();if(busy)return bad('Non puoi bloccare notti già prenotate',409);const id=crypto.randomUUID();await DB.prepare('INSERT INTO blocks(id,start_date,end_date,description) VALUES(?,?,?,?)').bind(id,b.start,b.end,String(b.description||'').slice(0,120)).run();return J({ok:true})}
 if(sub==='blocks/delete'&&method==='POST'){await DB.prepare('DELETE FROM blocks WHERE id=?').bind(String(b.id||'')).run();return J({ok:true})}
 if(sub==='admin/quote'&&method==='POST'){const q=await pricing(DB,b.start,b.end,Number(b.guests));return J(q)}
 if(sub==='photos/upload'&&method==='POST'){
  if(!/^image\/(jpeg|webp|png)$/.test(b.mime||'')||typeof b.data!=='string'||b.data.length>480000||!/^[-A-Za-z0-9+/=]+$/.test(b.data))return bad('Foto non valida o troppo grande: max ~350 KB');
  const count=await DB.prepare('SELECT COUNT(*) AS n FROM photos').first();if(count.n>=12)return bad('Massimo 12 fotografie');
  const id=crypto.randomUUID();await DB.prepare('INSERT INTO photos(id,mime,data,created_at) VALUES(?,?,?,?)').bind(id,b.mime,b.data,new Date().toISOString()).run();return J({id,url:'/api/photo?id='+id});
 }
 if(sub==='photos/delete'&&method==='POST'){
  const id=String(b.id||'');const site=await settings(DB);const src='/api/photo?id='+id;site.gallery=(site.gallery||[]).filter(x=>x!==src);
  await DB.batch([DB.prepare('DELETE FROM photos WHERE id=?').bind(id),DB.prepare("UPDATE settings SET value=? WHERE key='site'").bind(JSON.stringify(site))]);return J({ok:true});
 }
 if(sub==='payments/add'&&method==='POST'){
  const row=await DB.prepare('SELECT id,price FROM requests WHERE id=?').bind(String(b.requestId||'')).first();if(!row)return bad('Prenotazione inesistente',404);
  const amount=Number(b.amount);if(!Number.isInteger(amount)||amount<=0||amount>1000000)return bad('Importo non valido');
  const existing=await DB.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE request_id=?').bind(row.id).first();
  if(existing.total+amount>row.price)return bad('Il pagamento supera il prezzo della prenotazione');
  const id=crypto.randomUUID();await DB.prepare('INSERT INTO payments(id,request_id,amount,method,note,created_at) VALUES(?,?,?,?,?,?)').bind(id,row.id,amount,String(b.method||'altro').slice(0,30),String(b.note||'').slice(0,200),new Date().toISOString()).run();return J({ok:true,id});
 }
 if(sub==='payments/delete'&&method==='POST'){await DB.prepare('DELETE FROM payments WHERE id=?').bind(String(b.id||'')).run();return J({ok:true})}
 if(sub==='requests/manual'&&method==='POST'){
  if(typeof b.name!=='string'||b.name.trim().length<2||b.name.length>90||typeof b.phone!=='string'||!/^[+\d\s()\-]{7,22}$/.test(b.phone))return bad('Nome o telefono non valido');
  const q=await pricing(DB,b.start,b.end,Number(b.guests));const price=b.price===undefined?q.total:Number(b.price);
  if(!Number.isInteger(price)||price<1||price>1000000)return bad('Prezzo non valido');
  const id='BH-'+crypto.randomUUID().slice(0,8).toUpperCase();await DB.prepare('INSERT INTO requests(id,name,phone,email,start_date,end_date,guests,nights,price,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,b.name.trim(),b.phone.trim(),String(b.email||'').slice(0,150),b.start,b.end,+b.guests,q.nights,price,'pending',new Date().toISOString()).run();return J({ok:true,id});
 }
 if(sub==='requests/edit'&&method==='POST'){
  const row=await DB.prepare('SELECT * FROM requests WHERE id=?').bind(String(b.id||'')).first();if(!row)return bad('Richiesta inesistente',404);
  const start=b.start||row.start_date,end=b.end||row.end_date,guests=Number(b.guests??row.guests);
  if(!dateOK(start)||!dateOK(end)||diff(start,end)<1||diff(start,end)>90||!Number.isInteger(guests)||guests<1||guests>4)return bad('Date o ospiti non validi');
  const name=String(b.name??row.name).trim(),phone=String(b.phone??row.phone).trim();if(name.length<2||name.length>90||!/^\+?[\d\s()\-]{7,22}$/.test(phone))return bad('Nome o telefono non valido');
  const price=Number(b.price??row.price);if(!Number.isInteger(price)||price<1||price>1000000)return bad('Prezzo non valido');const paid=await DB.prepare('SELECT COALESCE(SUM(amount),0) AS n FROM payments WHERE request_id=?').bind(row.id).first();if(paid.n>price)return bad('Il prezzo non può essere inferiore agli incassi già registrati');
  if(row.status==='confirmed'){
   const taken=await DB.prepare("SELECT 1 FROM reserved_nights WHERE day>=? AND day<? AND request_id<>? UNION ALL SELECT 1 FROM blocks WHERE start_date<? AND end_date>? LIMIT 1").bind(start,end,row.id,end,start).first();if(taken)return bad('Intervallo occupato',409);
   const ops=[DB.prepare('DELETE FROM reserved_nights WHERE request_id=?').bind(row.id)];for(let day=start;day<end;day=addDay(day,1))ops.push(DB.prepare('INSERT INTO reserved_nights(day,request_id) VALUES(?,?)').bind(day,row.id));
   ops.push(DB.prepare('UPDATE requests SET name=?,phone=?,email=?,start_date=?,end_date=?,guests=?,nights=?,price=? WHERE id=?').bind(name,phone,String(b.email??row.email??'').slice(0,150),start,end,guests,diff(start,end),price,row.id));
   try{await DB.batch(ops)}catch{return bad('Conflitto sulle date',409)}
  }else await DB.prepare('UPDATE requests SET name=?,phone=?,email=?,start_date=?,end_date=?,guests=?,nights=?,price=? WHERE id=?').bind(name,phone,String(b.email??row.email??'').slice(0,150),start,end,guests,diff(start,end),price,row.id).run();
  return J({ok:true});
 }
 if(sub==='requests/status'&&method==='POST'){
  if(!['confirmed','rejected','cancelled','pending'].includes(b.status))return bad('Stato non valido');
  const row=await DB.prepare('SELECT * FROM requests WHERE id=?').bind(String(b.id||'')).first();if(!row)return bad('Richiesta inesistente',404);
  if(b.status==='confirmed'){
   if(row.status==='confirmed')return J({ok:true});
   // Atomic guard against concurrent overlapping confirmations in D1 through a unique per-night inventory.
   const nights=diff(row.start_date,row.end_date);if(nights>90)return bad('Soggiorno troppo lungo');
   const taken=await DB.prepare("SELECT 1 FROM requests WHERE status='confirmed' AND id<>? AND start_date<? AND end_date>? UNION ALL SELECT 1 FROM blocks WHERE start_date<? AND end_date>? LIMIT 1").bind(row.id,row.end_date,row.start_date,row.end_date,row.start_date).first();if(taken)return bad('Date già occupate');
   // Explicit occupied-night unique keys prevent races; insert reservation nights then update status in batch.
   const insert=[];for(let d=row.start_date;d<row.end_date;d=addDay(d,1))insert.push(DB.prepare('INSERT INTO reserved_nights(day,request_id) VALUES(?,?)').bind(d,row.id));
   try{await DB.batch([...insert,DB.prepare('UPDATE requests SET status=? WHERE id=?').bind('confirmed',row.id)])}catch{return bad('Conflitto sul calendario: date già occupate',409)}
  }else{
   await DB.batch([DB.prepare('DELETE FROM reserved_nights WHERE request_id=?').bind(row.id),DB.prepare('UPDATE requests SET status=? WHERE id=?').bind(b.status,row.id)])
  }return J({ok:true})}
 return bad('Endpoint non trovato',404)
 }catch(e){return bad(e?.message||'Errore interno',e?.message?.includes('non disponibili')?409:400)}
}
