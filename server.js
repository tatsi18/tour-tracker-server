// server.js
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET =
  process.env.JWT_SECRET || "your-secret-key-change-this-in-production";

// Middleware
app.use(
  cors({
    origin: [
      "https://tour-tracker-server.onrender.com",
      "http://localhost:3000",
      "https://tour-tracker-client.vercel.app" // <-- NO COMMA HERE if it's the last item in the array!
    ], // <-- COMMA needed here to separate the origin array from the credentials property
    credentials: true,
  })
);
app.use(bodyParser.json());

// PostgreSQL pool for Neon
const db = new Pool({
  connectionString:
    "postgresql://neondb_owner:npg_p7yYFTQkeBl2@ep-empty-cake-ag9q30g1-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  ssl: {
    rejectUnauthorized: false,
  },
});

// Test DB connection
db.connect()
  .then(() => console.log("Connected to Neon database"))
  .catch((err) => console.error("Database connection error:", err));

// Root route
app.get("/", (req, res) => {
  res.send("Server is running");
});

/* ----- AUTHENTICATION MIDDLEWARE ----- */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Invalid or expired token." });
    }
    req.user = user;
    next();
  });
};

/* ----- AUTHENTICATION ROUTES ----- */

// Register new user
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password, email } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Username and password are required" });
    }

    if (password.length < 8) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters" });
    }

    const existingUser = await db.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: "Username already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await db.query(
      "INSERT INTO users (username, password_hash, email, created_at) VALUES ($1, $2, $3, NOW()) RETURNING user_id, username, email",
      [username, hashedPassword, email]
    );

    res.status(201).json({
      message: "User created successfully",
      user: result.rows[0],
    });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

// Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Username and password are required" });
    }

    const result = await db.query("SELECT * FROM users WHERE username = $1", [
      username,
    ]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    await db.query("UPDATE users SET last_login = NOW() WHERE user_id = $1", [
      user.user_id,
    ]);

    const token = jwt.sign(
      { userId: user.user_id, username: user.username },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        userId: user.user_id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// Verify token
app.get("/api/auth/verify", authenticateToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

/* ----- TOUREVENTS ----- */
// GET all events WITH JOINS to get agency names, colors, template names, ship names
app.get("/api/events", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        te.tour_id,
        te.custom_name,
        te.tour_date,
        te.start_time,
        te.end_time,
        te.tip_eur,
        te.tip_usd,
        te.agency_id,
        te.template_id,
        te.ship_id,
        ta.agency_name,
        ta.agency_color_code,
        tt.tour_type_name,
        cs.ship_name
      FROM tourevents te
      LEFT JOIN touragencies ta ON te.agency_id = ta.agency_id
      LEFT JOIN tourtemplates tt ON te.template_id = tt.template_id
      LEFT JOIN cruiseships cs ON te.ship_id = cs.ship_id
      ORDER BY te.tour_date, te.start_time
    `);

    console.log("Database query result:", result.rows);

    // Transform for FullCalendar
    const events = result.rows.map((event) => {
      console.log(
        `Event: ${event.custom_name}, Agency: ${event.agency_name}, Color: ${event.agency_color_code}`
      );
      return {
        id: event.tour_id,
        title: event.custom_name || event.tour_type_name,
        start: event.start_time,
        end: event.end_time,
        backgroundColor: event.agency_color_code || "#3788d8",
        borderColor: event.agency_color_code || "#3788d8",
        agency: event.agency_name,
        cruiseShip: event.ship_name,
        description: event.custom_name,
        tourType: event.tour_type_name,
        tipEUR: event.tip_eur,
        tipUSD: event.tip_usd,
        agencyId: event.agency_id,
        templateId: event.template_id,
        shipId: event.ship_id,
      };
    });

    console.log("Sending events to frontend:", events);
    res.json(events);
  } catch (err) {
    console.error("Database SELECT error:", err);
    res.status(500).json({ error: "Database SELECT error" });
  }
});

// GET detailed tour data for reports
app.get("/api/tours-detailed", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        te.tour_id,
        te.custom_name,
        te.tour_date,
        te.start_time,
        te.end_time,
        te.base_price,
        te.tip_eur,
        te.tip_usd,
        te.payment_status,
        te.agency_id,
        te.template_id,
        te.ship_id,
        ta.agency_name,
        ta.calculation_scenario,
        tt.tour_type_name,
        cs.ship_name
      FROM tourevents te
      LEFT JOIN touragencies ta ON te.agency_id = ta.agency_id
      LEFT JOIN tourtemplates tt ON te.template_id = tt.template_id
      LEFT JOIN cruiseships cs ON te.ship_id = cs.ship_id
      ORDER BY te.tour_date, te.start_time
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("Database SELECT error:", err);
    res.status(500).json({ error: "Database SELECT error" });
  }
});

// Mark tours as paid for a specific month and agency
app.post("/api/mark-month-paid", async (req, res) => {
  try {
    const { month, agencyId, isPaid } = req.body;

    // Parse the Greek month format to get year and month number
    const [monthName, year] = month.split(" ");

    // Greek month names to numbers
    const greekMonths = {
      Ιανουάριος: 1,
      Φεβρουάριος: 2,
      Μάρτιος: 3,
      Απρίλιος: 4,
      Μάιος: 5,
      Ιούνιος: 6,
      Ιούλιος: 7,
      Αύγουστος: 8,
      Σεπτέμβριος: 9,
      Οκτώβριος: 10,
      Νοέμβριος: 11,
      Δεκέμβριος: 12,
    };

    const monthNum = greekMonths[monthName];

    if (!monthNum || !year) {
      return res.status(400).json({ error: "Invalid month format" });
    }

    // Update all tours for this agency in this month
    const result = await db.query(
      `UPDATE tourevents 
       SET payment_status = $1 
       WHERE agency_id = $2 
       AND EXTRACT(MONTH FROM tour_date) = $3 
       AND EXTRACT(YEAR FROM tour_date) = $4
       RETURNING *`,
      [isPaid ? "Paid" : "Unpaid", agencyId, monthNum, year]
    );

    res.json({ success: true, updated: result.rowCount });
  } catch (err) {
    console.error("Mark month paid error:", err);
    res.status(500).json({ error: "Failed to update payment status" });
  }
});

// POST new event
app.post("/api/events", async (req, res) => {
  try {
    const {
      custom_name,
      tour_date,
      start_time,
      end_time,
      agency_id,
      template_id,
      ship_id,
      tip_eur,
      tip_usd,
    } = req.body;

    const startTimestamp = `${tour_date} ${start_time}:00`;
    const endTimestamp = `${tour_date} ${end_time}:00`;

    // First, get the default_base_price from the template
    const templateResult = await db.query(
      "SELECT default_base_price FROM tourtemplates WHERE template_id = $1",
      [template_id]
    );

    const basePrice = templateResult.rows[0]?.default_base_price || 0;

    const result = await db.query(
      `INSERT INTO tourevents
       (custom_name, tour_date, start_time, end_time, agency_id, template_id, ship_id, base_price, payment_status, tip_eur, tip_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        custom_name,
        tour_date,
        startTimestamp,
        endTimestamp,
        agency_id,
        template_id,
        ship_id,
        basePrice,
        "Unpaid",
        tip_eur,
        tip_usd,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("POST Event error:", err);
    res.status(500).json({ error: "POST Event error", details: err.message });
  }
});

// PUT update event - FIXED to handle tip_eur and tip_usd
app.put("/api/events/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      custom_name,
      tour_date,
      start_time,
      end_time,
      agency_id,
      template_id,
      ship_id,
      tip_eur,
      tip_usd,
    } = req.body;

    const startTimestamp = `${tour_date} ${start_time}:00`;
    const endTimestamp = `${tour_date} ${end_time}:00`;

    const result = await db.query(
      `UPDATE tourevents
       SET custom_name=$1, tour_date=$2, start_time=$3, end_time=$4, agency_id=$5, template_id=$6, ship_id=$7, tip_eur=$8, tip_usd=$9
       WHERE tour_id=$10 RETURNING *`,
      [
        custom_name,
        tour_date,
        startTimestamp,
        endTimestamp,
        agency_id,
        template_id,
        ship_id,
        tip_eur,
        tip_usd,
        id,
      ]
    );

    if (result.rowCount === 0)
      return res.status(404).json({ error: "Event not found" });

    res.json(result.rows[0]);
  } catch (err) {
    console.error("PUT Event error:", err);
    res.status(500).json({ error: "PUT Event error" });
  }
});

// DELETE event
app.delete("/api/events/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      "DELETE FROM tourevents WHERE tour_id=$1 RETURNING *",
      [id]
    );

    if (result.rowCount === 0)
      return res.status(404).json({ error: "Event not found" });

    res.json({ message: "Event deleted successfully" });
  } catch (err) {
    console.error("DELETE Event error:", err);
    res.status(500).json({ error: "DELETE Event error" });
  }
});

/* ----- TOURAGENCIES ----- */
// GET all agencies
app.get("/api/agencies", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT * FROM touragencies ORDER BY agency_id"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("GET Agencies error:", err);
    res.status(500).json({ error: "GET Agencies error" });
  }
});

// POST new agency
app.post("/api/agencies", async (req, res) => {
  try {
    const { agency_name, agency_color_code, calculation_scenario } = req.body;
    const result = await db.query(
      `INSERT INTO touragencies (agency_name, agency_color_code, calculation_scenario)
       VALUES ($1,$2,$3) RETURNING *`,
      [agency_name, agency_color_code, calculation_scenario]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("POST Agency error:", err);
    res.status(500).json({ error: "POST Agency error" });
  }
});

// PUT update agency
app.put("/api/agencies/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { agency_name, agency_color_code, calculation_scenario } = req.body;
    const result = await db.query(
      `UPDATE touragencies
       SET agency_name=$1, agency_color_code=$2, calculation_scenario=$3
       WHERE agency_id=$4 RETURNING *`,
      [agency_name, agency_color_code, calculation_scenario, id]
    );
    if (result.rowCount === 0)
      return res.status(404).json({ error: "Agency not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("PUT Agency error:", err);
    res.status(500).json({ error: "PUT Agency error" });
  }
});

// DELETE agency
app.delete("/api/agencies/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      "DELETE FROM touragencies WHERE agency_id=$1 RETURNING *",
      [id]
    );
    if (result.rowCount === 0)
      return res.status(404).json({ error: "Agency not found" });
    res.json({ message: "Agency deleted successfully" });
  } catch (err) {
    console.error("DELETE Agency error:", err);
    res.status(500).json({ error: "DELETE Agency error" });
  }
});

/* ----- TOURTEMPLATES ----- */
// GET all templates
app.get("/api/templates", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT template_id, tour_type_name AS template_name, default_base_price FROM tourtemplates ORDER BY template_id"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("GET Templates error:", err);
    res.status(500).json({ error: "GET Templates error" });
  }
});

// Alias for compatibility with SettingsPage
app.get("/api/tourtypes", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT template_id as tour_type_id, tour_type_name as type_name, default_base_price as base_price FROM tourtemplates ORDER BY template_id"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("GET Tour Types error:", err);
    res.status(500).json({ error: "GET Tour Types error" });
  }
});

// POST new template
app.post("/api/templates", async (req, res) => {
  try {
    const { tour_type_name, default_base_price } = req.body;
    const result = await db.query(
      `INSERT INTO tourtemplates (tour_type_name, default_base_price)
       VALUES ($1,$2) RETURNING *`,
      [tour_type_name, default_base_price]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("POST Template error:", err);
    res.status(500).json({ error: "POST Template error" });
  }
});

// POST for tourtypes (alias)
app.post("/api/tourtypes", async (req, res) => {
  try {
    const { type_name, base_price } = req.body;
    const result = await db.query(
      `INSERT INTO tourtemplates (tour_type_name, default_base_price)
       VALUES ($1,$2) RETURNING template_id as tour_type_id, tour_type_name as type_name, default_base_price as base_price`,
      [type_name, base_price]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("POST Tour Type error:", err);
    res.status(500).json({ error: "POST Tour Type error" });
  }
});

// PUT update template
app.put("/api/templates/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { tour_type_name, default_base_price } = req.body;
    const result = await db.query(
      `UPDATE tourtemplates
       SET tour_type_name=$1, default_base_price=$2
       WHERE template_id=$3 RETURNING *`,
      [tour_type_name, default_base_price, id]
    );
    if (result.rowCount === 0)
      return res.status(404).json({ error: "Template not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("PUT Template error:", err);
    res.status(500).json({ error: "PUT Template error" });
  }
});

// PUT for tourtypes (alias)
app.put("/api/tourtypes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { type_name, base_price } = req.body;
    const result = await db.query(
      `UPDATE tourtemplates
       SET tour_type_name=$1, default_base_price=$2
       WHERE template_id=$3 RETURNING template_id as tour_type_id, tour_type_name as type_name, default_base_price as base_price`,
      [type_name, base_price, id]
    );
    if (result.rowCount === 0)
      return res.status(404).json({ error: "Tour Type not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("PUT Tour Type error:", err);
    res.status(500).json({ error: "PUT Tour Type error" });
  }
});

// DELETE template
app.delete("/api/templates/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      "DELETE FROM tourtemplates WHERE template_id=$1 RETURNING *",
      [id]
    );
    if (result.rowCount === 0)
      return res.status(404).json({ error: "Template not found" });
    res.json({ message: "Template deleted successfully" });
  } catch (err) {
    console.error("DELETE Template error:", err);
    res.status(500).json({ error: "DELETE Template error" });
  }
});

// DELETE for tourtypes (alias)
app.delete("/api/tourtypes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      "DELETE FROM tourtemplates WHERE template_id=$1 RETURNING *",
      [id]
    );
    if (result.rowCount === 0)
      return res.status(404).json({ error: "Tour Type not found" });
    res.json({ message: "Tour Type deleted successfully" });
  } catch (err) {
    console.error("DELETE Tour Type error:", err);
    res.status(500).json({ error: "DELETE Tour Type error" });
  }
});

/* ----- CRUISESHIPS ----- */
// GET all ships
app.get("/api/ships", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM cruiseships ORDER BY ship_id");
    res.json(result.rows);
  } catch (err) {
    console.error("GET Ships error:", err);
    res.status(500).json({ error: "GET Ships error" });
  }
});

// Alias for compatibility with SettingsPage
app.get("/api/cruiseships", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM cruiseships ORDER BY ship_id");
    res.json(result.rows);
  } catch (err) {
    console.error("GET Cruise Ships error:", err);
    res.status(500).json({ error: "GET Cruise Ships error" });
  }
});

// POST new ship
app.post("/api/ships", async (req, res) => {
  try {
    const { ship_name } = req.body;
    const result = await db.query(
      `INSERT INTO cruiseships (ship_name) VALUES ($1) RETURNING *`,
      [ship_name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("POST Ship error:", err);
    res.status(500).json({ error: "POST Ship error" });
  }
});

// POST for cruiseships (alias)
app.post("/api/cruiseships", async (req, res) => {
  try {
    const { ship_name } = req.body;
    const result = await db.query(
      `INSERT INTO cruiseships (ship_name) VALUES ($1) RETURNING *`,
      [ship_name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("POST Cruise Ship error:", err);
    res.status(500).json({ error: "POST Cruise Ship error" });
  }
});

// PUT update ship
app.put("/api/ships/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { ship_name } = req.body;
    const result = await db.query(
      `UPDATE cruiseships SET ship_name=$1 WHERE ship_id=$2 RETURNING *`,
      [ship_name, id]
    );
    if (result.rowCount === 0)
      return res.status(404).json({ error: "Ship not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("PUT Ship error:", err);
    res.status(500).json({ error: "PUT Ship error" });
  }
});

// PUT for cruiseships (alias)
app.put("/api/cruiseships/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { ship_name } = req.body;
    const result = await db.query(
      `UPDATE cruiseships SET ship_name=$1 WHERE ship_id=$2 RETURNING *`,
      [ship_name, id]
    );
    if (result.rowCount === 0)
      return res.status(404).json({ error: "Cruise Ship not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("PUT Cruise Ship error:", err);
    res.status(500).json({ error: "PUT Cruise Ship error" });
  }
});

// DELETE ship
app.delete("/api/ships/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      "DELETE FROM cruiseships WHERE ship_id=$1 RETURNING *",
      [id]
    );
    if (result.rowCount === 0)
      return res.status(404).json({ error: "Ship not found" });
    res.json({ message: "Ship deleted successfully" });
  } catch (err) {
    console.error("DELETE Ship error:", err);
    res.status(500).json({ error: "DELETE Ship error" });
  }
});

// DELETE for cruiseships (alias)
app.delete("/api/cruiseships/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      "DELETE FROM cruiseships WHERE ship_id=$1 RETURNING *",
      [id]
    );
    if (result.rowCount === 0)
      return res.status(404).json({ error: "Cruise Ship not found" });
    res.json({ message: "Cruise Ship deleted successfully" });
  } catch (err) {
    console.error("DELETE Cruise Ship error:", err);
    res.status(500).json({ error: "DELETE Cruise Ship error" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
