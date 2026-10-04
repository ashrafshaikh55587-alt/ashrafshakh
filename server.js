require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "prozone.db"));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'user',
 balance REAL NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 description TEXT NOT NULL,
 price REAL NOT NULL,
 image TEXT DEFAULT '',
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 total REAL NOT NULL,
 method TEXT NOT NULL,
 txid TEXT DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS order_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id INTEGER NOT NULL,
 product_id INTEGER NOT NULL,
 quantity INTEGER NOT NULL,
 price REAL NOT NULL,
 FOREIGN KEY(order_id) REFERENCES orders(id),
 FOREIGN KEY(product_id) REFERENCES products(id)
);
`);

const adminEmail = process.env.ADMIN_EMAIL || "admin@example.com";
const adminPassword = process.env.ADMIN_PASSWORD || "ChangeMe123!";
const existingAdmin = db.prepare("SELECT id FROM users WHERE email=?").get(adminEmail);
if (!existingAdmin) {
  db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)")
    .run("Admin", adminEmail, bcrypt.hashSync(adminPassword, 12), "admin");
}

const count = db.prepare("SELECT COUNT(*) c FROM products").get().c;
if (!count) {
  const seed = db.prepare("INSERT INTO products(name,description,price,image) VALUES(?,?,?,?)");
  seed.run("Digital Starter Pack", "A legal downloadable digital product.", 20, "");
  seed.run("Premium Template Pack", "Editable templates for legitimate business use.", 50, "");
  seed.run("Creator Bundle", "A collection of licensed digital assets.", 100, "");
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || "replace-me",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 1000*60*60*24*7 }
}));
app.use(express.static(path.join(__dirname, "public")));

function auth(req,res,next){ if(!req.session.user) return res.status(401).json({error:"Login required"}); next(); }
function admin(req,res,next){ if(!req.session.user || req.session.user.role!=="admin") return res.status(403).json({error:"Admin only"}); next(); }

app.get("/api/config", (req,res)=>res.json({
  btc: process.env.BTC_ADDRESS || "",
  ltc: process.env.LTC_ADDRESS || ""
}));

app.post("/api/register", async (req,res)=>{
  const {name,email,password}=req.body;
  if(!name || !email || !password || password.length<8) return res.status(400).json({error:"Name, email and an 8+ character password are required."});
  try {
    const hash=await bcrypt.hash(password,12);
    const r=db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)").run(name,email.toLowerCase().trim(),hash);
    req.session.user={id:r.lastInsertRowid,name,email:email.toLowerCase().trim(),role:"user"};
    res.json({ok:true});
  } catch(e){ res.status(400).json({error:"Email is already registered."}); }
});

app.post("/api/login", async (req,res)=>{
  const {email,password}=req.body;
  const u=db.prepare("SELECT * FROM users WHERE email=?").get((email||"").toLowerCase().trim());
  if(!u || !(await bcrypt.compare(password||"",u.password_hash))) return res.status(401).json({error:"Invalid email or password."});
  req.session.user={id:u.id,name:u.name,email:u.email,role:u.role};
  res.json({ok:true});
});

app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));

app.get("/api/me",(req,res)=>{
  if(!req.session.user) return res.json({user:null});
  const u=db.prepare("SELECT id,name,email,role,balance,created_at FROM users WHERE id=?").get(req.session.user.id);
  res.json({user:u});
});

app.get("/api/products",(req,res)=>{
  res.json(db.prepare("SELECT id,name,description,price,image FROM products WHERE active=1 ORDER BY id DESC").all());
});

app.get("/api/orders",auth,(req,res)=>{
  res.json(db.prepare(`
    SELECT o.*, GROUP_CONCAT(oi.product_id || ':' || oi.quantity, ',') items
    FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id
    WHERE o.user_id=? GROUP BY o.id ORDER BY o.id DESC
  `).all(req.session.user.id));
});

app.post("/api/orders",auth,(req,res)=>{
  const {items,method,txid}=req.body;
  if(!Array.isArray(items)||!items.length||!["BTC","LTC"].includes(method)) return res.status(400).json({error:"Invalid order."});
  const ids=items.map(x=>Number(x.product_id)).filter(Boolean);
  const products=db.prepare(`SELECT id,name,price FROM products WHERE active=1 AND id IN (${ids.map(()=>"?").join(",")})`).all(...ids);
  const map=new Map(products.map(p=>[p.id,p]));
  let total=0, clean=[];
  for(const x of items){
    const p=map.get(Number(x.product_id)); const q=Math.max(1,Math.min(99,Number(x.quantity)||1));
    if(!p) return res.status(400).json({error:"Product unavailable."});
    total += p.price*q; clean.push({id:p.id,q,price:p.price});
  }
  const orderTx=(txid||"").trim().slice(0,200);
  const create=db.transaction(()=>{
    const o=db.prepare("INSERT INTO orders(user_id,total,method,txid) VALUES(?,?,?,?)").run(req.session.user.id,total,method,orderTx);
    const ins=db.prepare("INSERT INTO order_items(order_id,product_id,quantity,price) VALUES(?,?,?,?)");
    for(const x of clean) ins.run(o.lastInsertRowid,x.id,x.q,x.price);
    return o.lastInsertRowid;
  });
  res.json({ok:true,orderId:create()});
});

app.get("/api/admin/orders",admin,(req,res)=>{
  res.json(db.prepare(`
    SELECT o.id,o.total,o.method,o.txid,o.status,o.created_at,u.name,u.email
    FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC
  `).all());
});

app.patch("/api/admin/orders/:id",admin,(req,res)=>{
  const status=req.body.status;
  if(!["pending","approved","rejected"].includes(status)) return res.status(400).json({error:"Invalid status"});
  db.prepare("UPDATE orders SET status=? WHERE id=?").run(status,req.params.id);
  res.json({ok:true});
});

app.post("/api/admin/products",admin,(req,res)=>{
  const {name,description,price,image}=req.body;
  if(!name||!description||!(Number(price)>0)) return res.status(400).json({error:"Invalid product"});
  const r=db.prepare("INSERT INTO products(name,description,price,image) VALUES(?,?,?,?)").run(name,description,Number(price),image||"");
  res.json({id:r.lastInsertRowid});
});

app.delete("/api/admin/products/:id",admin,(req,res)=>{
  db.prepare("UPDATE products SET active=0 WHERE id=?").run(req.params.id); res.json({ok:true});
});

app.listen(PORT,()=>console.log(`Prozone running on http://localhost:${PORT}`));
