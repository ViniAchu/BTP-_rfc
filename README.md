<<<<<<< HEAD
# SAP BTP Chat Agent — Deployment Guide

## Project Structure

```
btp-chat-agent/
├── public/
│   └── index.html          ← Frontend chat UI
├── index.js                ← Express backend (all routes)
├── package.json            ← Dependencies
├── manifest.yml            ← CF deployment config
├── xs-security.json        ← XSUAA role config
└── default-env.json        ← LOCAL TESTING ONLY (never commit)
```

---

## STEP 1 — One-time: Create BTP Service Instances

Open terminal in SAP Business Application Studio (BAS):

```bash
# Login first
cf login -a https://api.cf.ap10.hana.ondemand.com
# (replace ap10 with your region)

# Create all required services
cf create-service destination        lite        my-destination-service
cf create-service connectivity       lite        my-connectivity-service
cf create-service xsuaa              application my-xsuaa-service -c xs-security.json
cf create-service postgresql-db      development my-postgres-db

# Wait for services to finish creating (check with):
cf services
```

---

## STEP 2 — Configure Cloud Connector (on-premise server)

1. Open Cloud Connector Admin UI: `https://localhost:8443`
2. **Add Subaccount** → enter your BTP subaccount ID, region, and login
3. **Cloud To On-Premise → Access Control → Add:**
   - Back-end Type: `ABAP System`
   - Protocol: `HTTP`
   - Internal Host: `your-real-sap-host.internal`
   - Internal Port: `8000` (or your SAP HTTP port)
   - Virtual Host: `sap-backend-virtual`
   - Virtual Port: `8000`
4. **Add Resource:**
   - URL Path: `/sap/opu/odata/`
   - Active: checked
   - Access Policy: Path and all sub-paths

---

## STEP 3 — Configure BTP Destination

BTP Cockpit → Connectivity → Destinations → New Destination:

```
Name:           MyBackend
Type:           HTTP
URL:            http://sap-backend-virtual:8000
Proxy Type:     OnPremise
Authentication: BasicAuthentication
User:           YOUR_SAP_RFC_USER
Password:       YOUR_SAP_PASSWORD
```

Click "Check Connection" — should show green.

---

## STEP 4 — Update OData Path in index.js

In `index.js`, find this line and replace with your actual OData service:

```javascript
url: `/sap/opu/odata/sap/YOUR_SERVICE_SRV/${tableName}Set`,
```

For USR02 data specifically, use:
```javascript
url: `/sap/opu/odata/sap/ZUSER_INFO_SRV/USR02Set`,
```

Ask your BASIS/ABAP team for the correct OData service name.

---

## STEP 5 — Deploy to BTP

In BAS terminal:

```bash
# Install dependencies
npm install

# Deploy
cf push

# Watch logs
cf logs btp-chat-agent --recent
```

---

## STEP 6 — Access the App

After `cf push` completes:

```bash
cf app btp-chat-agent
# Look for "routes:" — copy that URL
```

Open the URL in your browser. You will see the chat agent.

---

## STEP 7 — Use the App

1. Type a table name in the chat box, e.g. `USR02`
2. The agent fetches data through: **App → Destination → Cloud Connector → SAP Backend**
3. Records are saved to PostgreSQL
4. Click **Download CSV** in the left sidebar to export

---

## Local Testing (Optional)

1. Fill in `default-env.json` with credentials from BTP Cockpit
2. Run: `npm start`
3. Open: `http://localhost:3000`

---

## Troubleshooting

| Error | Fix |
|---|---|
| `No destination found` | Check `my-destination-service` is bound in manifest.yml |
| `System Offline` (red) | Check Cloud Connector is Connected (green) in SCC admin |
| `403 Forbidden` | Whitelist the OData path in Cloud Connector Resources |
| `PostgreSQL error` | Run `cf services` — ensure `my-postgres-db` shows "create succeeded" |
| `cf not found` | Use BAS terminal, not Windows PowerShell |

---

## CI/CD Automation (Optional)

1. Push code to GitHub
2. BTP Cockpit → Instances → Subscribe to **Continuous Integration & Delivery**
3. Create a Job:
   - Pipeline: `SAP Cloud SDK`
   - Repository: your GitHub repo
   - Branch: `main`
   - Build: npm install
   - Deploy: Cloud Foundry, point to your org/space, manifest path `./manifest.yml`
4. Add GitHub webhook from the Repositories tab
5. Every `git push` auto-deploys
=======
# vinitha.jagadeeshwaran01
>>>>>>> f426ab260863a0a501b96e5bf398c38067ab7f89
