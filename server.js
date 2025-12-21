// server.js
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { Pool } = require("pg");
const pg = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const webpush = require("web-push");
const cron = require("node-cron");
require("dotenv").config();

// =========================================================================
// 🛑 CRITICAL FIX: OVERRIDE PG DATE PARSING
// =========================================================================
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, function (stringValue) {
  return stringValue;
});
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, function (stringValue) {
  return stringValue;
});
pg.types.setTypeParser(pg.types.builtins.DATE, function (stringValue) {
  return stringValue;
});
// =========================================================================

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET =
  process.env.JWT_SECRET || "your-secret-key-change-this-in-production";

// Configure web-push with VAPID keys (only if keys are provided)
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || "mailto:example@yourdomain.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  console.log("✓ Push notifications enabled");
} else {
  console.warn("⚠️  VAPID keys not found - Push notifications disabled");
  console.warn("   Run 'npx web-push generate-vapid-keys' to generate keys");
}

// Middleware
app.use(
  cors({
    origin: [
      "https://tour-tracker-client.vercel.app",
      "http://localhost:5173",
      "https://tour-tracker-server.onrender.com",
      "null",
    ],
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

/* ----- PUSH NOTIFICATION FUNCTIONS ----- */

// Function to send notification to a user
async function sendNotificationToUser(userId, title, body, data = {}) {
  try {
    // Get all subscriptions for this user
    const subscriptions = await db.query(
      "SELECT * FROM push_subscriptions WHERE user_id = $1",
      [userId]
    );

    const payload = JSON.stringify({
      title,
      body,
      icon: "/icon-192x192.png", // You can add your app icon
      badge: "/badge-72x72.png",
      data,
    });

    // Send to all user's devices
    const notifications = subscriptions.rows.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          payload
        );
      } catch (error) {
        console.error("Error sending notification:", error);
        // If subscription is invalid, remove it
        if (error.statusCode === 410 || error.statusCode === 404) {
          await db.query(
            "DELETE FROM push_subscriptions WHERE subscription_id = $1",
            [sub.subscription_id]
          );
        }
      }
    });

    await Promise.all(notifications);
  } catch (error) {
    console.error("Send notification error:", error);
  }
}

// Check for upcoming tours and send notifications
async function checkUpcomingTours() {
  try {
    const now = new Date();
    
    // Check for tours starting in 90 minutes (with 2.5 minute buffer on each side)
    const notify90Time = new Date(now.getTime() + 90 * 60000);
    const notify90TimeStart = new Date(now.getTime() + 87.5 * 60000); // 87.5 min
    const notify90TimeEnd = new Date(now.getTime() + 92.5 * 60000); // 92.5 min

    // Check for tours starting in 60 minutes (with 2.5 minute buffer on each side)
    const notify60Time = new Date(now.getTime() + 60 * 60000);
    const notify60TimeStart = new Date(now.getTime() + 57.5 * 60000); // 57.5 min
    const notify60TimeEnd = new Date(now.getTime() + 62.5 * 60000); // 62.5 min

    // Get tours for 90-minute notification
    const tours90min = await db.query(
      `
      SELECT 
        te.tour_id,
        te.user_id,
        te.custom_name,
        te.start_time,
        tt.tour_type_name,
        ta.agency_name,
        cs.ship_name
      FROM tourevents te
      LEFT JOIN tourtemplates tt ON te.template_id = tt.template_id
      LEFT JOIN touragencies ta ON te.agency_id = ta.agency_id
      LEFT JOIN cruiseships cs ON te.ship_id = cs.ship_id
      WHERE te.status = 'confirmed'
      AND te.start_time BETWEEN $1 AND $2
      `,
      [notify90TimeStart.toISOString(), notify90TimeEnd.toISOString()]
    );

    // Get tours for 60-minute notification
    const tours60min = await db.query(
      `
      SELECT 
        te.tour_id,
        te.user_id,
        te.custom_name,
        te.start_time,
        tt.tour_type_name,
        ta.agency_name,
        cs.ship_name
      FROM tourevents te
      LEFT JOIN tourtemplates tt ON te.template_id = tt.template_id
      LEFT JOIN touragencies ta ON te.agency_id = ta.agency_id
      LEFT JOIN cruiseships cs ON te.ship_id = cs.ship_id
      WHERE te.status = 'confirmed'
      AND te.start_time BETWEEN $3 AND $4
      `,
      [notify60TimeStart.toISOString(), notify60TimeEnd.toISOString()]
    );

    // Send 90-minute notifications
    for (const tour of tours90min.rows) {
      const tourName = tour.custom_name || tour.tour_type_name;
      const title = `🔔 Tour Starting in 90 Minutes`;
      const body = `${tourName}\nAgency: ${tour.agency_name}\nShip: ${tour.ship_name}`;

      await sendNotificationToUser(tour.user_id, title, body, {
        tourId: tour.tour_id,
        type: "tour-reminder-90",
        minutesUntil: 90
      });
      
      console.log(`Sent 90-min notification for tour ${tour.tour_id} to user ${tour.user_id}`);
    }

    // Send 60-minute notifications
    for (const tour of tours60min.rows) {
      const tourName = tour.custom_name || tour.tour_type_name;
      const title = `⏰ Tour Starting in 60 Minutes!`;
      const body = `${tourName}\nAgency: ${tour.agency_name}\nShip: ${tour.ship_name}`;

      await sendNotificationToUser(tour.user_id, title, body, {
        tourId: tour.tour_id,
        type: "tour-reminder-60",
        minutesUntil: 60
      });
      
      console.log(`Sent 60-min notification for tour ${tour.tour_id} to user ${tour.user_id}`);
    }

    if (tours90min.rows.length > 0 || tours60min.rows.length > 0) {
      console.log(`Sent ${tours90min.rows.length} 90-min and ${tours60min.rows.length} 60-min notifications`);
    }
  } catch (error) {
    console.error("Check upcoming tours error:", error);
  }
}

// Run every 5 minutes to check for upcoming tours
cron.schedule("*/5 * * * *", () => {
  console.log("Checking for upcoming tours...");
  checkUpcomingTours();
}, {
  scheduled: true,
  timezone: "Europe/Athens" // Set your timezone
});

// Run once on startup to catch any tours we might have missed
setTimeout(() => {
  console.log("Running initial tour check on startup...");
  checkUpcomingTours();
}, 5000); // Wait 5 seconds after startup

/* ----- PUSH NOTIFICATION ROUTES ----- */

// Get VAPID public key
app.get("/api/notifications/vapid-public-key", (req, res) => {
  if (!process.env.VAPID_PUBLIC_KEY) {
    return res.status(503).json({ 
      error: "Push notifications not configured",
      message: "VAPID keys are not set on the server"
    });
  }
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// Subscribe to push notifications
app.post("/api/notifications/subscribe", authenticateToken, async (req, res) => {
  try {
    const { endpoint, keys } = req.body;

    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return res.status(400).json({ error: "Invalid subscription data" });
    }

    // Store subscription in database
    await db.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, endpoint) DO UPDATE
       SET p256dh = $3, auth = $4`,
      [req.user.userId, endpoint, keys.p256dh, keys.auth]
    );

    res.json({ message: "Subscription saved successfully" });
  } catch (error) {
    console.error("Subscribe error:", error);
    res.status(500).json({ error: "Failed to save subscription" });
  }
});

// Unsubscribe from push notifications
app.post("/api/notifications/unsubscribe", authenticateToken, async (req, res) => {
  try {
    const { endpoint } = req.body;

    await db.query(
      "DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2",
      [req.user.userId, endpoint]
    );

    res.json({ message: "Unsubscribed successfully" });
  } catch (error) {
    console.error("Unsubscribe error:", error);
    res.status(500).json({ error: "Failed to unsubscribe" });
  }
});

// Test notification endpoint (for testing)
app.post("/api/notifications/test", authenticateToken, async (req, res) => {
  try {
    await sendNotificationToUser(
      req.user.userId,
      "Test Notification",
      "This is a test notification from Tour Tracker!",
      { type: "test" }
    );
    res.json({ message: "Test notification sent" });
  } catch (error) {
    console.error("Test notification error:", error);
    res.status(500).json({ error: "Failed to send test notification" });
  }
});

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

// Reset password
app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const { username, newPassword } = req.body;

    if (!username || !newPassword) {
      return res
        .status(400)
        .json({ error: "Username and new password are required" });
    }

    if (newPassword.length < 8) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters" });
    }

    const userResult = await db.query(
      "SELECT user_id FROM users WHERE username = $1",
      [username]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await db.query(
      "UPDATE users SET password_hash = $1 WHERE username = $2",
      [hashedPassword, username]
    );

    res.json({ message: "Password reset successfully" });
  } catch (err) {
    console.error("Password reset error:", err);
    res.status(500).json({ error: "Password reset failed" });
  }
});

// Verify token
app.get("/api/auth/verify", authenticateToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

/* ----- TOUREVENTS ----- */
// GET all events - NOW FILTERED BY USER
app.get("/api/events", authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `
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
        te.status,
        ta.agency_name,
        ta.agency_color_code,
        tt.tour_type_name,
        cs.ship_name
      FROM tourevents te
      LEFT JOIN touragencies ta ON te.agency_id = ta.agency_id
      LEFT JOIN tourtemplates tt ON te.template_id = tt.template_id
      LEFT JOIN cruiseships cs ON te.ship_id = cs.ship_id
      WHERE te.user_id = $1
      ORDER BY te.tour_date, te.start_time
    `,
      [req.user.userId]
    );

    const events = result.rows.map((event) => ({
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
      status: event.status,
    }));

    res.json(events);
  } catch (err) {
    console.error("Database SELECT error:", err);
    res.status(500).json({ error: "Database SELECT error" });
  }
});

// GET detailed tour data for reports - FILTERED BY USER
app.get("/api/tours-detailed", authenticateToken, async (req, res) => {
  try {
    const { includeCancelled } = req.query;
    
    let statusFilter = includeCancelled === 'true' ? '' : "AND te.status = 'confirmed'";
    
    const result = await db.query(
      `
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
        te.status,
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
      WHERE te.user_id = $1
      ${statusFilter}
      ORDER BY te.tour_date, te.start_time
    `,
      [req.user.userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Database SELECT error:", err);
    res.status(500).json({ error: "Database SELECT error" });
  }
});

// Mark tours as paid - USER-SPECIFIC
app.post("/api/mark-month-paid", authenticateToken, async (req, res) => {
  try {
    const { month, agencyId, isPaid } = req.body;
    const [monthName, year] = month.split(" ");

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

    const result = await db.query(
      `UPDATE tourevents 
       SET payment_status = $1 
       WHERE agency_id = $2 
       AND user_id = $3
       AND status = 'confirmed'
       AND EXTRACT(MONTH FROM tour_date) = $4 
       AND EXTRACT(YEAR FROM tour_date) = $5
       RETURNING *`,
      [isPaid ? "Paid" : "Unpaid", agencyId, req.user.userId, monthNum, year]
    );

    res.json({ success: true, updated: result.rowCount });
  } catch (err) {
    console.error("Mark month paid error:", err);
    res.status(500).json({ error: "Failed to update payment status" });
  }
});

// POST new event - INCLUDES USER_ID
app.post("/api/events", authenticateToken, async (req, res) => {
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

    const templateResult = await db.query(
      "SELECT default_base_price FROM tourtemplates WHERE template_id = $1",
      [template_id]
    );

    const basePrice = templateResult.rows[0]?.default_base_price || 0;

    const result = await db.query(
      `INSERT INTO tourevents
       (custom_name, tour_date, start_time, end_time, agency_id, template_id, ship_id, base_price, payment_status, tip_eur, tip_usd, user_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
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
        req.user.userId,
        'confirmed'
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("POST Event error:", err);
    res.status(500).json({ error: "POST Event error", details: err.message });
  }
});

// PUT update event - CHECKS USER OWNERSHIP
app.put("/api/events/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const checkResult = await db.query(
      "SELECT user_id FROM tourevents WHERE tour_id = $1",
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: "Tour not found" });
    }

    if (checkResult.rows[0].user_id.toString() !== req.user.userId.toString()) {
      return res.status(403).json({ error: "Access denied" });
    }

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

    res.json(result.rows[0]);
  } catch (err) {
    console.error("PUT Event error:", err);
    res.status(500).json({ error: "PUT Event error" });
  }
});

// Cancel a tour (instead of deleting)
app.patch("/api/events/:id/cancel", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const checkResult = await db.query(
      "SELECT user_id FROM tourevents WHERE tour_id = $1",
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: "Tour not found" });
    }

    if (checkResult.rows[0].user_id.toString() !== req.user.userId.toString()) {
      return res.status(403).json({ error: "Access denied" });
    }

    const result = await db.query(
      `UPDATE tourevents 
       SET status = 'cancelled'
       WHERE tour_id = $1 
       RETURNING *`,
      [id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Cancel tour error:", err);
    res.status(500).json({ error: "Failed to cancel tour" });
  }
});

// Restore a cancelled tour
app.patch("/api/events/:id/restore", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const checkResult = await db.query(
      "SELECT user_id FROM tourevents WHERE tour_id = $1",
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: "Tour not found" });
    }

    if (checkResult.rows[0].user_id.toString() !== req.user.userId.toString()) {
      return res.status(403).json({ error: "Access denied" });
    }

    const result = await db.query(
      `UPDATE tourevents 
       SET status = 'confirmed'
       WHERE tour_id = $1 
       RETURNING *`,
      [id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Restore tour error:", err);
    res.status(500).json({ error: "Failed to restore tour" });
  }
});

// Get cancellation statistics
app.get("/api/cancellation-stats", authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let dateFilter = "";
    const params = [req.user.userId];
    
    if (startDate && endDate) {
      dateFilter = "AND te.tour_date BETWEEN $2 AND $3";
      params.push(startDate, endDate);
    }

    const agencyStats = await db.query(
      `
      SELECT 
        ta.agency_name,
        ta.agency_color_code,
        COUNT(*) as cancelled_count,
        COALESCE(SUM(te.base_price), 0) as lost_base_amount,
        COALESCE(SUM(te.tip_eur), 0) as lost_tip_eur,
        COALESCE(SUM(te.tip_usd), 0) as lost_tip_usd
      FROM tourevents te
      LEFT JOIN touragencies ta ON te.agency_id = ta.agency_id
      WHERE te.user_id = $1 
      AND te.status = 'cancelled'
      ${dateFilter}
      GROUP BY ta.agency_id, ta.agency_name, ta.agency_color_code
      ORDER BY cancelled_count DESC
      `,
      params
    );

    const shipStats = await db.query(
      `
      SELECT 
        cs.ship_name,
        COUNT(*) as cancelled_count,
        COALESCE(SUM(te.base_price), 0) as lost_base_amount,
        COALESCE(SUM(te.tip_eur), 0) as lost_tip_eur,
        COALESCE(SUM(te.tip_usd), 0) as lost_tip_usd
      FROM tourevents te
      LEFT JOIN cruiseships cs ON te.ship_id = cs.ship_id
      WHERE te.user_id = $1 
      AND te.status = 'cancelled'
      ${dateFilter}
      GROUP BY cs.ship_id, cs.ship_name
      ORDER BY cancelled_count DESC
      `,
      params
    );

    const totals = await db.query(
      `
      SELECT 
        COUNT(*) as total_cancelled,
        COALESCE(SUM(base_price), 0) as total_lost_base,
        COALESCE(SUM(tip_eur), 0) as total_lost_tip_eur,
        COALESCE(SUM(tip_usd), 0) as total_lost_tip_usd
      FROM tourevents
      WHERE user_id = $1 
      AND status = 'cancelled'
      ${dateFilter}
      `,
      params
    );

    res.json({
      byAgency: agencyStats.rows,
      byShip: shipStats.rows,
      totals: totals.rows[0]
    });
  } catch (err) {
    console.error("Cancellation stats error:", err);
    res.status(500).json({ error: "Failed to get cancellation stats" });
  }
});

// DELETE event - USER-SPECIFIC
app.delete("/api/events/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      "DELETE FROM tourevents WHERE tour_id=$1 AND user_id=$2 RETURNING *",
      [id, req.user.userId]
    );

    if (result.rowCount === 0)
      return res.status(404).json({ error: "Event not found" });

    res.json({ message: "Event deleted successfully" });
  } catch (err) {
    console.error("DELETE Event error:", err);
    res.status(500).json({ error: "DELETE Event error" });
  }
});

/* ----- AGENCIES, TEMPLATES, SHIPS (SHARED - AUTHENTICATED ACCESS ONLY) ----- */

app.get("/api/agencies", authenticateToken, async (req, res) => {
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

app.post("/api/agencies", authenticateToken, async (req, res) => {
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

app.put("/api/agencies/:id", authenticateToken, async (req, res) => {
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

app.delete("/api/agencies/:id", authenticateToken, async (req, res) => {
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

app.get("/api/templates", authenticateToken, async (req, res) => {
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

app.get("/api/tourtypes", authenticateToken, async (req, res) => {
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

app.post("/api/templates", authenticateToken, async (req, res) => {
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

app.post("/api/tourtypes", authenticateToken, async (req, res) => {
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

app.put("/api/templates/:id", authenticateToken, async (req, res) => {
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

app.put("/api/tourtypes/:id", authenticateToken, async (req, res) => {
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

app.delete("/api/templates/:id", authenticateToken, async (req, res) => {
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

app.delete("/api/tourtypes/:id", authenticateToken, async (req, res) => {
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

app.get("/api/ships", authenticateToken, async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM cruiseships ORDER BY ship_id");
    res.json(result.rows);
  } catch (err) {
    console.error("GET Ships error:", err);
    res.status(500).json({ error: "GET Ships error" });
  }
});

app.get("/api/cruiseships", authenticateToken, async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM cruiseships ORDER BY ship_id");
    res.json(result.rows);
  } catch (err) {
    console.error("GET Cruise Ships error:", err);
    res.status(500).json({ error: "GET Cruise Ships error" });
  }
});

app.post("/api/ships", authenticateToken, async (req, res) => {
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

app.post("/api/cruiseships", authenticateToken, async (req, res) => {
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

app.put("/api/ships/:id", authenticateToken, async (req, res) => {
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

app.put("/api/cruiseships/:id", authenticateToken, async (req, res) => {
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

app.delete("/api/ships/:id", authenticateToken, async (req, res) => {
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

app.delete("/api/cruiseships/:id", authenticateToken, async (req, res) => {
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
  console.log("Push notification cron job started - checking every 5 minutes");
});