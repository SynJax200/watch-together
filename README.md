# Dekho Together — Screen Share Tool (India ⇄ UK)

Ek chhota WebRTC-based tool jisse tum aur tumhara dost apni screen share karke
saath mein kuch dekh sakte ho, peer-to-peer connection ke through (no third
party dekh sakti tumhari screen, na hi data unke server pe store hota hai).

## Ye kaam kaise karta hai (short version)

1. **Signaling server** (`server.js`) — sirf dono logon ko ek dusre se
   "introduce" karta hai. Room code se match hota hai kaun kis se connect
   hoga. Actual screen data isse hokar kabhi nahi jaata.
2. Introduction hone ke baad, browsers seedha ek dusre se **WebRTC** ke
   through connect ho jaate hain aur screen data direct peer-to-peer flow
   karta hai — isliye latency kam hoti hai.
3. Agar dono ke routers/ISP strict NAT/firewall use karte hain (jo India-UK
   jaisi long-distance connection mein common hai), to direct connection
   fail ho sakta hai. Isi liye **TURN server** zaroori hai — ye ek relay ka
   kaam karta hai jab direct connection nahi ban paata.

## Local par chalane ke liye

```bash
npm install
npm start
```

Fir browser mein `http://localhost:3000` kholo. Do tabs/browsers mein kholke
test kar sakte ho.

## Actual use ke liye (India-UK) — deployment zaroori hai

Local machine par chalane se sirf tumhare local network ke andar hi kaam
karega. Dost tak pahunchane ke liye is server ko internet par deploy karna
hoga. Free options:

- **Render.com** (free tier available) — GitHub repo connect karke deploy
  kar sakte ho
- **Railway.app**
- **Fly.io**

Deploy karne ke baad jo bhi public URL milega (jaise
`https://tumhara-app.onrender.com`), wahi link dono share karoge.

## TURN server setup (IMPORTANT — smooth connection ke liye)

`public/client.js` mein ek `ICE_SERVERS` array hai jisme abhi sirf Google ka
free STUN server hai. Long-distance (India-UK) connections ke liye ye kaafi
nahi hoga har case mein — TURN server add karna strongly recommended hai:

**Free/cheap options:**
- [Metered.ca](https://www.metered.ca/tools/openrelay/) — free TURN
  credentials milte hain, quick setup
- [Twilio STUN/TURN](https://www.twilio.com/docs/stun-turn) — pay-as-you-go,
  very reliable
- Apna khud ka **coturn** server (VPS pe self-host, sabse cheap long-term
  agar tumhe regular use karna hai)

Jo bhi choose karo, `client.js` mein ye add karo:

```js
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: "turn:your-turn-server.com:3478",
    username: "your-username",
    credential: "your-password"
  }
];
```

## Smooth performance ke liye tips

- Screen share karte time **frame rate 30fps pe capped** hai (bandwidth
  bachane ke liye) — `client.js` mein `getDisplayMedia` call mein change kar
  sakte ho agar chahiye.
- Video ke instead sirf ek specific window/tab share karo (poori screen ki
  jagah) — kam bandwidth lagti hai, less lag.
- Dono taraf stable wifi/broadband use karo — mobile hotspot pe latency
  spike hota hai.
- Page ke neeche "Ping" aur "Packets lost" dikhta hai — agar ping
  200-300ms se zyada consistently rahe ya packets lost badhte jaayein, to
  connection quality kharab hai (TURN server add karna ya dono ki internet
  speed check karna help karega).

## File structure

```
screenshare-tool/
├── server.js          # Signaling server (Express + Socket.io)
├── package.json
├── public/
│   ├── index.html      # UI
│   └── client.js        # WebRTC logic (screen capture, peer connection, stats)
└── README.md
```

## Limitations (abhi ke version mein)

- Ek time pe sirf 2 log ek room mein (one-to-one screen share)
- Text chat ya voice call built-in nahi hai (agar chahiye to bata dena, add
  kar denge)
- Recording feature nahi hai
