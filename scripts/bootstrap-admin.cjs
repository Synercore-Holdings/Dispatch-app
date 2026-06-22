const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

async function main() {
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME;
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!username || !email || !password) {
    console.log("Bootstrap admin variables not set; skipping initial admin creation.");
    return;
  }

  if (password.length < 12) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters.");
  }

  const prisma = new PrismaClient();
  try {
    const existingAdmin = await prisma.user.findFirst({ where: { role: "admin" } });
    if (existingAdmin) {
      console.log("An administrator already exists; skipping bootstrap.");
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: { username, email, password: passwordHash, role: "admin" },
    });
    console.log("Initial PTA administrator created.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Failed to bootstrap administrator:", error);
  process.exit(1);
});
