const express = require("express");
const cors = require("cors");
const { Sequelize, DataTypes } = require("sequelize");
const mongoose = require("mongoose");
const { createClient } = require("redis");

const PORT = Number(process.env.PORT || 3000);
const SERVER_ID = process.env.SERVER_ID || "backend-local";
const DATABASE_URL = process.env.DATABASE_URL || "postgres://kr4_user:kr4_password@localhost:5432/kr4_db";
const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost:27017/kr4_db";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const USERS_CACHE_TTL = 60;
const PRODUCTS_CACHE_TTL = 600;

const app = express();
app.use(cors());
app.use(express.json());

const sequelize = new Sequelize(DATABASE_URL, {
  dialect: "postgres",
  logging: false
});

const PgUser = sequelize.define(
  "User",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    first_name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    last_name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    age: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 0
      }
    },
    created_at: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    updated_at: {
      type: DataTypes.BIGINT,
      allowNull: false
    }
  },
  {
    tableName: "users",
    timestamps: false
  }
);

const mongoUserSchema = new mongoose.Schema(
  {
    id: {
      type: Number,
      unique: true,
      required: true
    },
    first_name: {
      type: String,
      required: true
    },
    last_name: {
      type: String,
      required: true
    },
    age: {
      type: Number,
      required: true,
      min: 0
    },
    created_at: {
      type: Number,
      required: true
    },
    updated_at: {
      type: Number,
      required: true
    }
  },
  {
    versionKey: false
  }
);

mongoUserSchema.index({ id: 1 });
const MongoUser = mongoose.model("MongoUser", mongoUserSchema);

const redisClient = createClient({ url: REDIS_URL });
redisClient.on("error", (err) => {
  console.error("Redis error:", err.message);
});

const products = [
  {
    id: 1,
    name: "Ноутбук",
    price: 75000,
    description: "Игровой ноутбук"
  },
  {
    id: 2,
    name: "Смартфон",
    price: 45000,
    description: "Смартфон для учебного примера"
  }
];

function nowUnix() {
  return Date.now();
}

function validateUserBody(body, partial = false) {
  const errors = [];

  if (!partial || body.first_name !== undefined) {
    if (!body.first_name || typeof body.first_name !== "string") {
      errors.push("first_name is required and must be a string");
    }
  }

  if (!partial || body.last_name !== undefined) {
    if (!body.last_name || typeof body.last_name !== "string") {
      errors.push("last_name is required and must be a string");
    }
  }

  if (!partial || body.age !== undefined) {
    if (!Number.isInteger(body.age) || body.age < 0) {
      errors.push("age is required and must be a positive integer");
    }
  }

  return errors;
}

async function getCache(key) {
  if (!redisClient.isOpen) {
    return null;
  }

  const value = await redisClient.get(key);
  return value ? JSON.parse(value) : null;
}

async function setCache(key, data, ttl) {
  if (!redisClient.isOpen) {
    return;
  }

  await redisClient.set(key, JSON.stringify(data), { EX: ttl });
}

async function delCache(keys) {
  if (!redisClient.isOpen || keys.length === 0) {
    return;
  }

  await redisClient.del(keys);
}

async function invalidateUsersCache(userId) {
  const keys = ["pg-users:all"];
  if (userId) {
    keys.push(`pg-users:${userId}`);
  }
  await delCache(keys);
}

async function invalidateProductsCache(productId) {
  const keys = ["products:all"];
  if (productId) {
    keys.push(`products:${productId}`);
  }
  await delCache(keys);
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

app.get("/", (req, res) => {
  res.json({
    message: "KR4 backend response",
    server: SERVER_ID,
    port: PORT,
    timestamp: nowUnix()
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    server: SERVER_ID,
    postgres: "connected",
    mongo: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    redis: redisClient.isOpen ? "connected" : "disconnected"
  });
});

app.post(
  "/api/users",
  asyncHandler(async (req, res) => {
    const errors = validateUserBody(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    const timestamp = nowUnix();
    const user = await PgUser.create({
      first_name: req.body.first_name.trim(),
      last_name: req.body.last_name.trim(),
      age: req.body.age,
      created_at: timestamp,
      updated_at: timestamp
    });

    await invalidateUsersCache();
    return res.status(201).json(user);
  })
);

app.get(
  "/api/users",
  asyncHandler(async (req, res) => {
    const cacheKey = "pg-users:all";
    const cached = await getCache(cacheKey);
    if (cached) {
      return res.json({ source: "cache", data: cached });
    }

    const users = await PgUser.findAll({ order: [["id", "ASC"]] });
    await setCache(cacheKey, users, USERS_CACHE_TTL);
    return res.json({ source: "server", data: users });
  })
);

app.get(
  "/api/users/:id",
  asyncHandler(async (req, res) => {
    const cacheKey = `pg-users:${req.params.id}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      return res.json({ source: "cache", data: cached });
    }

    const user = await PgUser.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    await setCache(cacheKey, user, USERS_CACHE_TTL);
    return res.json({ source: "server", data: user });
  })
);

app.patch(
  "/api/users/:id",
  asyncHandler(async (req, res) => {
    const errors = validateUserBody(req.body, true);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    const user = await PgUser.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (req.body.first_name !== undefined) user.first_name = req.body.first_name.trim();
    if (req.body.last_name !== undefined) user.last_name = req.body.last_name.trim();
    if (req.body.age !== undefined) user.age = req.body.age;
    user.updated_at = nowUnix();
    await user.save();

    await invalidateUsersCache(user.id);
    return res.json(user);
  })
);

app.delete(
  "/api/users/:id",
  asyncHandler(async (req, res) => {
    const deletedCount = await PgUser.destroy({ where: { id: req.params.id } });
    if (!deletedCount) {
      return res.status(404).json({ error: "User not found" });
    }

    await invalidateUsersCache(req.params.id);
    return res.json({ message: "User deleted", id: Number(req.params.id) });
  })
);

app.post(
  "/api/mongo-users",
  asyncHandler(async (req, res) => {
    const errors = validateUserBody(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    const lastUser = await MongoUser.findOne().sort({ id: -1 });
    const timestamp = nowUnix();
    const user = await MongoUser.create({
      id: lastUser ? lastUser.id + 1 : 1,
      first_name: req.body.first_name.trim(),
      last_name: req.body.last_name.trim(),
      age: req.body.age,
      created_at: timestamp,
      updated_at: timestamp
    });

    return res.status(201).json(user);
  })
);

app.get(
  "/api/mongo-users",
  asyncHandler(async (req, res) => {
    const users = await MongoUser.find().sort({ id: 1 });
    return res.json(users);
  })
);

app.get(
  "/api/mongo-users/:id",
  asyncHandler(async (req, res) => {
    const user = await MongoUser.findOne({ id: Number(req.params.id) });
    if (!user) {
      return res.status(404).json({ error: "Mongo user not found" });
    }

    return res.json(user);
  })
);

app.patch(
  "/api/mongo-users/:id",
  asyncHandler(async (req, res) => {
    const errors = validateUserBody(req.body, true);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    const update = { updated_at: nowUnix() };
    if (req.body.first_name !== undefined) update.first_name = req.body.first_name.trim();
    if (req.body.last_name !== undefined) update.last_name = req.body.last_name.trim();
    if (req.body.age !== undefined) update.age = req.body.age;

    const user = await MongoUser.findOneAndUpdate({ id: Number(req.params.id) }, update, { new: true });
    if (!user) {
      return res.status(404).json({ error: "Mongo user not found" });
    }

    return res.json(user);
  })
);

app.delete(
  "/api/mongo-users/:id",
  asyncHandler(async (req, res) => {
    const user = await MongoUser.findOneAndDelete({ id: Number(req.params.id) });
    if (!user) {
      return res.status(404).json({ error: "Mongo user not found" });
    }

    return res.json({ message: "Mongo user deleted", id: Number(req.params.id) });
  })
);

app.get(
  "/api/products",
  asyncHandler(async (req, res) => {
    const cacheKey = "products:all";
    const cached = await getCache(cacheKey);
    if (cached) {
      return res.json({ source: "cache", data: cached });
    }

    await setCache(cacheKey, products, PRODUCTS_CACHE_TTL);
    return res.json({ source: "server", data: products });
  })
);

app.get(
  "/api/products/:id",
  asyncHandler(async (req, res) => {
    const cacheKey = `products:${req.params.id}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      return res.json({ source: "cache", data: cached });
    }

    const product = products.find((item) => item.id === Number(req.params.id));
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    await setCache(cacheKey, product, PRODUCTS_CACHE_TTL);
    return res.json({ source: "server", data: product });
  })
);

app.post(
  "/api/products",
  asyncHandler(async (req, res) => {
    if (!req.body.name || !Number.isFinite(req.body.price)) {
      return res.status(400).json({ error: "name and price are required" });
    }

    const product = {
      id: products.length ? Math.max(...products.map((item) => item.id)) + 1 : 1,
      name: String(req.body.name).trim(),
      price: Number(req.body.price),
      description: String(req.body.description || "").trim()
    };

    products.push(product);
    await invalidateProductsCache();
    return res.status(201).json(product);
  })
);

app.patch(
  "/api/products/:id",
  asyncHandler(async (req, res) => {
    const product = products.find((item) => item.id === Number(req.params.id));
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    if (req.body.name !== undefined) product.name = String(req.body.name).trim();
    if (req.body.price !== undefined) product.price = Number(req.body.price);
    if (req.body.description !== undefined) product.description = String(req.body.description).trim();

    await invalidateProductsCache(product.id);
    return res.json(product);
  })
);

app.delete(
  "/api/products/:id",
  asyncHandler(async (req, res) => {
    const index = products.findIndex((item) => item.id === Number(req.params.id));
    if (index === -1) {
      return res.status(404).json({ error: "Product not found" });
    }

    const [deleted] = products.splice(index, 1);
    await invalidateProductsCache(deleted.id);
    return res.json({ message: "Product deleted", id: deleted.id });
  })
);

app.use((err, req, res, next) => {
  console.error(err);
  return res.status(500).json({ error: "Internal server error", details: err.message });
});

async function connectWithRetry(name, connect, attempts = 20) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await connect();
      console.log(`${name} connected`);
      return;
    } catch (error) {
      lastError = error;
      console.log(`${name} connection attempt ${attempt}/${attempts} failed: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  throw lastError;
}

async function start() {
  await connectWithRetry("PostgreSQL", async () => {
    await sequelize.authenticate();
    await sequelize.sync();
  });

  await connectWithRetry("MongoDB", async () => {
    await mongoose.connect(MONGO_URL);
  });

  await connectWithRetry("Redis", async () => {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`KR4 ${SERVER_ID} started on port ${PORT}`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error("Application start failed:", err);
    process.exit(1);
  });
}

module.exports = {
  app,
  start
};
