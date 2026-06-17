const express = require("express");
const { executeHttpRequest } = require("@sap-cloud-sdk/http-client");
const xsenv = require("@sap/xsenv");
const { Client } = require("pg");
const path = require("path");

// Load BTP environment variables (uses default-env.json locally, VCAP_SERVICES on BTP)
xsenv.loadEnv();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const port = process.env.PORT || 3000;

// ─── PostgreSQL Config from BTP Service Binding ──────────────────────────────
let pgConfig = null;
try {
  const pgServices = xsenv.getServices({ postgres: { tag: "postgres" } });
  pgConfig = {
    connectionString: pgServices.postgres.uri,
    ssl: { rejectUnauthorized: false },
  };
} catch (e) {
  console.warn("PostgreSQL service binding not found. DB features disabled.");
}

// ─── Helper: get a new PG client ─────────────────────────────────────────────
async function getDbClient() {
  if (!pgConfig) throw new Error("No PostgreSQL service bound to this app.");
  const client = new Client(pgConfig);
  await client.connect();
  // Ensure table exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS sap_data (
      id          SERIAL PRIMARY KEY,
      table_name  TEXT,
      data        JSONB,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  return client;
}

// ─── 1. SERVE FRONTEND ────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─── 2. CONNECTIVITY STATUS CHECK ────────────────────────────────────────────
// Verifies: BTP App → Destination → Cloud Connector → SAP Backend
app.get("/status", async (req, res) => {
  try {
    await executeHttpRequest(
      { destinationName: "MyBackend" },
      { method: "HEAD", url: "/" }
    );
    res.json({ status: "Online", message: "Cloud Connector & Destination are reachable." });
  } catch (error) {
    const code = error.response ? error.response.status : "Network Error";
    res.status(500).json({
      status: "Offline",
      message: `Error ${code}: Check Cloud Connector mapping and Destination config.`,
    });
  }
});

// ─── 3. CHAT AGENT — Extract + Save ──────────────────────────────────────────
// POST /chat  { "message": "USR02" }
app.post("/chat", async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.json({ reply: "Please enter a table name (e.g. USR02)." });
  }

  // Accept bare table names OR sentences like "Extract USR02"
  const tableName = message.trim().split(/\s+/).pop().toUpperCase();

  try {
    // ── Fetch from SAP Backend via Destination Service → Cloud Connector ──
    const response = await executeHttpRequest(
      { destinationName: "MyBackend" },
      {
        method: "GET",
        // RFC_READ_TABLE-style OData — update YOUR_SERVICE_SRV to your actual service
        url: `/sap/opu/odata/sap/YOUR_SERVICE_SRV/${tableName}Set`,
        headers: { Accept: "application/json" },
      }
    );

    const records =
      response.data?.d?.results ||
      response.data?.value ||
      response.data ||
      [];

    if (!Array.isArray(records) || records.length === 0) {
      return res.json({
        reply: `No records found for table "${tableName}". Check the table name and OData service path.`,
      });
    }

    // ── Save to PostgreSQL ──────────────────────────────────────────────────
    const client = await getDbClient();
    try {
      for (const record of records) {
        await client.query(
          "INSERT INTO sap_data (table_name, data) VALUES ($1, $2)",
          [tableName, JSON.stringify(record)]
        );
      }
    } finally {
      await client.end();
    }

    // ── Build a preview for the chat window ────────────────────────────────
    const preview = records.slice(0, 3).map((r, i) => {
      const fields = Object.entries(r)
        .filter(([k, v]) => typeof v !== "object" && !k.startsWith("__"))
        .slice(0, 4)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" | ");
      return `Record ${i + 1}: ${fields}`;
    });

    res.json({
      reply:
        `Extracted ${records.length} records from <b>${tableName}</b> and saved to database.\n\n` +
        preview.join("\n") +
        (records.length > 3 ? `\n… and ${records.length - 3} more.` : ""),
      count: records.length,
      table: tableName,
    });
  } catch (error) {
    console.error("Extraction Error:", error.message);
    res.json({
      reply: `Failed to extract <b>${tableName}</b>.<br>
              Error: ${error.message}<br><br>
              Check:<br>
              1. Cloud Connector status (must be green/Connected)<br>
              2. Destination "MyBackend" — ProxyType = OnPremise<br>
              3. OData service path is whitelisted in Cloud Connector`,
    });
  }
});

// ─── 4. EXTRACTION HISTORY ────────────────────────────────────────────────────
app.get("/history", async (req, res) => {
  try {
    const client = await getDbClient();
    const result = await client.query(`
      SELECT table_name,
             COUNT(*)            AS record_count,
             MAX(created_at)     AS last_extracted
      FROM sap_data
      GROUP BY table_name
      ORDER BY last_extracted DESC
    `);
    await client.end();
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── 5. CSV EXPORT ────────────────────────────────────────────────────────────
app.get("/export", async (req, res) => {
  const tableName = (req.query.table || "").toUpperCase();
  if (!tableName) return res.status(400).send("Provide ?table=TABLE_NAME");

  try {
    const client = await getDbClient();
    const result = await client.query(
      "SELECT data FROM sap_data WHERE table_name = $1 ORDER BY id",
      [tableName]
    );
    await client.end();

    if (result.rows.length === 0)
      return res.status(404).send(`No saved data found for table "${tableName}".`);

    const records = result.rows.map((r) =>
      typeof r.data === "string" ? JSON.parse(r.data) : r.data
    );
    const fields = Object.keys(records[0]).filter(
      (k) => typeof records[0][k] !== "object" && !k.startsWith("__")
    );

    const escapeCell = (val) => `"${String(val ?? "").replace(/"/g, '""')}"`;
    const csv = [
      fields.join(","),
      ...records.map((row) => fields.map((f) => escapeCell(row[f])).join(",")),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${tableName}_export.csv`
    );
    res.send(csv);
  } catch (error) {
    res.status(500).send("Export failed: " + error.message);
  }
});

// ─── 6. CLEAR ALL HISTORY ─────────────────────────────────────────────────────
app.delete("/clear", async (req, res) => {
  try {
    const client = await getDbClient();
    await client.query("TRUNCATE TABLE sap_data RESTART IDENTITY");
    await client.end();
    res.json({ reply: "All extraction history has been cleared from the database." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(port, () => {
  console.log(`SAP BTP Chat Agent running on port ${port}`);
  console.log(`Open: http://localhost:${port}`);
});
