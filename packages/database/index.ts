import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaNeon } from "@prisma/adapter-neon";
import "dotenv/config";
import { PrismaClient } from "./generated/prisma/client";

const connectionString = `${process.env.DATABASE_URL}`;

// RECUPERA FORK PATCH: upstream hardcoded PrismaNeon whenever NODE_ENV is
// "production". Neon's serverless driver speaks HTTP/WebSocket to a Neon
// endpoint, so it cannot talk to a plain TCP Postgres — which is what Railway
// (and most self-hosted installs) provide. The driver is now explicit:
// `DB_DRIVER=neon` opts into the serverless driver, anything else uses the
// standard pg adapter, which works everywhere including Neon's TCP pooler.
const adapter =
  process.env.DB_DRIVER === "neon"
    ? new PrismaNeon({ connectionString })
    : new PrismaPg({ connectionString });

const prisma = new PrismaClient({ adapter });

export { prisma };
