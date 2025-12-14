// migrate.js
const db = require("./db");

// SQL commands to create the four tables and seed initial data
const createTablesAndSeedData = async () => {
  try {
    console.log("Starting database migration...");

    // 1. Agencies Table (Stores scenario setting)
    await db.query(`
            CREATE TABLE IF NOT EXISTS Agencies (
                agency_id SERIAL PRIMARY KEY,
                agency_name VARCHAR(100) UNIQUE NOT NULL,
                agency_color_code VARCHAR(7) NOT NULL,
                calculation_scenario INT NOT NULL DEFAULT 1 
            );
        `);
    console.log("Table: Agencies created successfully.");

    // 2. TourTemplates Table (Stores base price defaults)
    await db.query(`
            CREATE TABLE IF NOT EXISTS TourTemplates (
                template_id SERIAL PRIMARY KEY,
                tour_type_name VARCHAR(100) UNIQUE NOT NULL,
                default_base_price DECIMAL(10, 2) NOT NULL
            );
        `);
    console.log("Table: TourTemplates created successfully.");

    // 3. CruiseShips Table
    await db.query(`
            CREATE TABLE IF NOT EXISTS CruiseShips (
                ship_id SERIAL PRIMARY KEY,
                ship_name VARCHAR(100) UNIQUE NOT NULL
            );
        `);
    console.log("Table: CruiseShips created successfully.");

    // 4. TourEvents Table (The main record of all tours)
    await db.query(`
            CREATE TABLE IF NOT EXISTS TourEvents (
                tour_id SERIAL PRIMARY KEY,
                tour_date DATE NOT NULL,
                base_price DECIMAL(10, 2) NOT NULL,
                payment_status VARCHAR(10) NOT NULL DEFAULT 'Unpaid',
                custom_net_override DECIMAL(10, 2),
                
                -- Foreign Keys linking to other tables
                agency_id INT REFERENCES Agencies(agency_id) ON DELETE CASCADE,
                template_id INT REFERENCES TourTemplates(template_id) ON DELETE SET NULL,
                ship_id INT REFERENCES CruiseShips(ship_id) ON DELETE SET NULL,

                -- Calculated financial outputs (stored for reports)
                calculated_net_payment DECIMAL(10, 2)
            );
        `);
    console.log("Table: TourEvents created successfully.");

    // ------------------------------------------------------------------
    // --- SEED DATA: Insert Initial Records ---
    // ------------------------------------------------------------------
    console.log("Inserting seed data...");

    // 1. Insert a few Agencies
    await db.query(`
            INSERT INTO Agencies (agency_id, agency_name, agency_color_code, calculation_scenario)
            VALUES 
                (1, 'Tour Guide Central', '#F44336', 1),
                (2, 'Cruise Line X', '#2196F3', 2)
            ON CONFLICT (agency_id) DO NOTHING;
        `);
    console.log("Seed Data: Agencies inserted.");

    // 💡 CRITICAL FIX: Reset the sequence to the MAX ID + 1.
    // This is the definitive way to fix sequence sync issues after manual insertion.
    await db.query(`
            SELECT setval('agencies_agency_id_seq', COALESCE((SELECT MAX(agency_id)+1 FROM Agencies), 1), false);
        `);
    console.log("Sequence successfully synchronized for Agencies table.");

    // 2. Insert some Tour Templates
    await db.query(`
            INSERT INTO TourTemplates (template_id, tour_type_name, default_base_price)
            VALUES 
                (1, 'Full Day Athens', 180.00),
                (2, 'Half Day Delphi', 120.00)
            ON CONFLICT (template_id) DO NOTHING;
        `);
    console.log("Seed Data: Tour Templates inserted.");

    // Reset sequence for TourTemplates
    await db.query(`
            SELECT setval('tourtemplates_template_id_seq', COALESCE((SELECT MAX(template_id)+1 FROM TourTemplates), 1), false);
        `);
    console.log("Sequence successfully synchronized for TourTemplates table.");

    // 3. Insert a Cruise Ship
    await db.query(`
            INSERT INTO CruiseShips (ship_id, ship_name)
            VALUES 
                (101, 'Explorer of the Seas')
            ON CONFLICT (ship_id) DO NOTHING;
        `);
    console.log("Seed Data: Cruise Ship inserted.");

    // Reset sequence for CruiseShips
    await db.query(`
            SELECT setval('cruiseships_ship_id_seq', COALESCE((SELECT MAX(ship_id)+1 FROM CruiseShips), 1), false);
        `);
    console.log("Sequence successfully synchronized for CruiseShips table.");

    console.log("✅ All tables created and seeded successfully!");
  } catch (err) {
    console.error("❌ Database migration failed:", err.stack);
  } finally {
    // Exit the script after migration is done (success or failure)
    process.exit();
  }
};

createTablesAndSeedData();
