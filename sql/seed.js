// Seeds one organization, three halls, and the exact validated seat layouts
// from the prototype (Nice Study Hall + Nandi Study Hall floor plans).
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { pool } = require("../src/lib/db");

const b = (n) => ({ num: n, blocked: true });
const p = "PILLAR";

// --- Nice Study Hall floor plan (validated across this whole build) ---
const NICE_PLAN = {
  topStrip: [136, 137, 138, 139, 140, 141, 142, 143, 144],
  rows: [
    [70, p, 71, 72, 73, 74], [69, 68, 67, 66, 65, 64],
    [58, 59, 60, 61, 62, 63], [57, 56, 55, 54, 53, 52],
    [47, p, 48, 49, 50, 51], [46, 45, 44, 43, 42, 41],
    [35, 36, 37, 38, 39, 40], [34, 33, 32, 31, 30, 29],
    [24, p, 25, 26, 27, 28], [23, 22, 21, 20, 19, 18],
    [12, 13, 14, 15, 16, 17], [11, 10, 9, 8, 7, null],
    [1, 2, 3, 4, 5, 6],
    [null, 132, 133, 134, 135], [131, 130, 129, 128, 127],
    [p, 123, 124, 125, 126], [122, 121, 120, 119, 118],
    [113, 114, 115, 116, 117], [112, 111, 110, 109, 108],
    [p, 104, 105, 106, 107], [103, 102, 101, 100, 99],
    [94, 95, 96, 97, 98], [93, 92, 91, 90, 89],
    [p, 85, 86, 87, 88], [84, 83, 82, 81, 80],
    [75, 76, 77, 78, 79],
    [150, 149, 148, 147, 146, 145], [151, 152, 153, 154, 155, 156],
    [161, 160, p, 159, 158, 157], [162, 163, 164, 165, 166, 167],
    [173, 172, 171, 170, 169, 168], [174, 175, 176, 177, 178, 179],
    [184, 183, 182, p, 181, 180], [185, 186, 187, 188, 189, 190],
    [196, 195, 194, 193, 192, 191], [197, 198, 199, 200, 201, 202],
    [206, 205, 204, p, 203, null], [207, 208, 209, 210, 211, null],
    [216, 215, 214, 213, 212, null], [217, 218, 219, 220, 221, null],
  ],
};

const NANDI_PLAN = {
  topStrip: [172, 171, 170, 169, 168, 167, 166, 165, 164],
  rows: [
    [156, 157, 158, 159, null, 160, 161, 162, 163], [155, 154, 153, 152, null, 151, 150, 149, 148],
    [140, 141, 142, 143, null, 144, 145, b(146), 147], [139, 138, 137, 136, null, 135, 134, 133, 132],
    [null, null, null, null, null, 128, 129, 130, 131],
    [124, 125], [null, null, 126, 127],
    [3, 2, 1], [4, 5, 6, 7], [11, 10, 9, 8], [12, 13, 14, 15, 16, 17],
    [20, 21], [19, 22], [18, 23],
    [117, 118, 119, 120, p, 121, 122, 123], [116, 115, 114, 113, 112, 111, 110, 109],
    [101, 102, 103, 104, 105, 106, 107, 108], [100, 99, 98, 97, p, 96, 95, 94],
    [86, 87, 88, 89, 90, 91, 92, 93], [85, 84, 83, 82, 81, 80, 79, 78],
    [71, 72, 73, 74, p, 75, 76, 77], [70, 69, 68, 67, 66, 65, 64, 63],
    [55, 56, 57, 58, 59, 60, 61, 62], [54, 53, 52, 51, 50, 49, 48, 47],
    [40, 41, 42, 43, 44, 45, b(46), 33], [39, 38, 37, 36, 35, 34, null, 32],
    [24, 25, 26, 27, 28, 29, 30, 31],
  ],
};

function flatten(plan) {
  const nums = new Set();
  plan.topStrip.forEach((n) => nums.add(n));
  plan.rows.forEach((row) => row.forEach((cell) => {
    if (cell == null || cell === p) return;
    nums.add(typeof cell === "object" ? cell.num : cell);
  }));
  return Array.from(nums).sort((a, c) => a - c);
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orgRes = await client.query(
      "INSERT INTO organizations (name) VALUES ($1) RETURNING id",
      ["Nice Study Centre"]
    );
    const orgId = orgRes.rows[0].id;

    const masterPasswordHash = await bcrypt.hash("ChangeThisPassword123!", 10);
    await client.query(
      `INSERT INTO admin_users (organization_id, name, phone, email, password_hash, role)
       VALUES ($1,$2,$3,$4,$5,'master')`,
      [orgId, "Master Admin", "9999999999", "admin@example.com", masterPasswordHash]
    );

    const halls = [
      { slug: "nice", name: "Nice Study Hall", plan: NICE_PLAN, lockerRange: [75, 135], baseFee: 1000, lockerFee: 1100, advance: 300 },
      { slug: "nandi", name: "Nandi Study Hall", plan: NANDI_PLAN, lockerRange: null, baseFee: 1000, lockerFee: 1000, advance: 300 },
      { slug: "nicecl", name: "Nice CL Study Hall", plan: NICE_PLAN, lockerRange: null, baseFee: 1000, lockerFee: 1000, advance: 300 },
    ];

    for (const hall of halls) {
      const hallRes = await client.query(
        `INSERT INTO halls (organization_id, slug, name) VALUES ($1,$2,$3) RETURNING id`,
        [orgId, hall.slug, hall.name]
      );
      const hallId = hallRes.rows[0].id;

      const seatNumbers = flatten(hall.plan);
      for (const num of seatNumbers) {
        const isLocker = hall.lockerRange && num >= hall.lockerRange[0] && num <= hall.lockerRange[1];
        const fee = isLocker ? hall.lockerFee : hall.baseFee;
        await client.query(
          `INSERT INTO seats (hall_id, seat_number, is_locker, fee_amount, advance_amount)
           VALUES ($1,$2,$3,$4,$5)`,
          [hallId, num, !!isLocker, fee, hall.advance]
        );
      }
      console.log(`Seeded ${hall.name}: ${seatNumbers.length} seats`);
    }

    await client.query("COMMIT");
    console.log("Seed complete. Master admin login: 9999999999 / ChangeThisPassword123!");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
