import { randomUUID } from 'node:crypto';
import { problem } from './validation.js';

const seedDishes = [
  ['江西炒粉', '江西风味', '米粉炒得干爽入味，青红椒带一点鲜辣。', 16],
  ['爆炒花甲', '江西风味', '花甲裹着姜蒜与辣椒的香气，鲜辣开胃。', 28],
  ['炒基围虾', '江西风味', '基围虾和葱姜快炒，虾肉鲜甜弹嫩。', 38],
  ['油焖大虾', '江西风味', '大虾焖到壳红肉嫩，酱汁浓香微甜。', 48],
  ['豆角焖面', '河南面食', '豆角和肉片一起焖，面条吸足了汤汁。', 18],
  ['菜莽', '河南面食', '薄面皮卷起韭菜和鸡蛋，上锅蒸到清香软嫩。', 16],
  ['红烧排骨', '家常菜', '排骨慢烧入味，油亮的酱汁适合拌饭。', 38],
  ['玉米炖排骨', '家常菜', '排骨和甜玉米小火慢炖，汤鲜清甜。', 32],
];

const quickDishes = [
  ['番茄炒蛋', '鸡蛋炒嫩后盛出，番茄炒出汁，再和鸡蛋一起翻匀。', 12],
  ['蒜蓉西兰花', '西兰花焯水后沥干，和蒜末一起快炒。', 12],
  ['香葱蒸蛋', '鸡蛋加温水打匀，隔水蒸嫩，出锅撒葱花。', 10],
  ['葱油拌面', '煮熟的面条拌入小火熬香的葱油和少许生抽。', 12],
  ['青椒炒豆干', '青椒和豆干切丝，用蒜末和生抽快速炒香。', 14],
  ['紫菜蛋花汤', '水烧开后下紫菜，淋入蛋液，最后撒葱花。', 8],
];

async function transaction(pool, action) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await action(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function initializeTables(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS kitchen_meta (
    name VARCHAR(32) PRIMARY KEY
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS kitchen_dishes (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(40) NOT NULL,
    category VARCHAR(24) NOT NULL,
    description VARCHAR(200) NOT NULL,
    image MEDIUMTEXT NOT NULL,
    price DECIMAL(8,2) NOT NULL,
    active BOOLEAN NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS kitchen_orders (
    id CHAR(36) PRIMARY KEY,
    customer VARCHAR(48) NOT NULL,
    status VARCHAR(12) NOT NULL,
    items JSON NOT NULL,
    note VARCHAR(500) NOT NULL,
    total DECIMAL(12,2) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX kitchen_orders_customer_created (customer, created_at),
    INDEX kitchen_orders_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS kitchen_sessions (
    token_hash BINARY(32) PRIMARY KEY,
    username VARCHAR(48) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    INDEX kitchen_sessions_expires (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await pool.query(`CREATE TABLE IF NOT EXISTS kitchen_categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(24) NOT NULL UNIQUE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await transaction(pool, async db => {
    // Keeping a seed marker prevents deleted dishes from being restored on a subsequent deploy.
    const [seed] = await db.execute('INSERT IGNORE INTO kitchen_meta (name) VALUES (?)', ['initial-menu']);
    for (const [index, [name, category, description, price]] of (seed.affectedRows ? seedDishes : []).entries()) {
      await db.execute('INSERT IGNORE INTO kitchen_dishes (id, name, category, description, image, price, active) VALUES (?, ?, ?, ?, ?, ?, TRUE)',
        [`dish-${index + 1}`, name, category, description, `assets/dish-${index + 1}.webp`, price]);
    }
    const [migration] = await db.execute('INSERT IGNORE INTO kitchen_meta (name) VALUES (?)', ['category-management']);
    if (migration.affectedRows) {
      for (const name of new Set(seedDishes.map(dish => dish[1]))) {
        await db.execute('INSERT IGNORE INTO kitchen_categories (name) VALUES (?)', [name]);
      }
      await db.query('INSERT IGNORE INTO kitchen_categories (name) SELECT DISTINCT category FROM kitchen_dishes');
    }
    await db.query("SELECT name FROM kitchen_meta WHERE name = 'category-management' FOR UPDATE");
    const [quickMenu] = await db.execute('INSERT IGNORE INTO kitchen_meta (name) VALUES (?)', ['quick-home-menu']);
    if (quickMenu.affectedRows) {
      await db.execute('INSERT IGNORE INTO kitchen_categories (name) VALUES (?)', ['家常菜']);
      for (const [index, [name, description, price]] of quickDishes.entries()) {
        await db.execute(`INSERT INTO kitchen_dishes (id, name, category, description, image, price, active)
          SELECT ?, ?, ?, ?, '', ?, TRUE WHERE NOT EXISTS (SELECT 1 FROM kitchen_dishes WHERE name = ?)`,
        [`quick-dish-${index + 1}`, name, '家常菜', description, price, name]);
      }
    }
    const [photos] = await db.execute('INSERT IGNORE INTO kitchen_meta (name) VALUES (?)', ['quick-home-menu-photos']);
    if (photos.affectedRows) {
      for (const index of quickDishes.keys()) {
        const id = `quick-dish-${index + 1}`;
        await db.execute("UPDATE kitchen_dishes SET image = ? WHERE id = ? AND image = ''", [`assets/${id}.jpg`, id]);
      }
    }
  });
}

function dishFromRow(row) {
  return { ...row, price: Number(row.price), active: Boolean(row.active) };
}

function orderFromRow(row) {
  return {
    id: row.id, customer: row.customer, status: row.status,
    items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items,
    note: row.note, total: Number(row.total),
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  };
}

const dishFields = 'id, name, category, description, image, price, active';

function orderOwners(username) {
  // The renamed account keeps access to orders placed under its previous name.
  return [username, username === 'ryj' ? 'customer' : username];
}

async function getDish(db, id) {
  const [[row]] = await db.execute(`SELECT ${dishFields} FROM kitchen_dishes WHERE id = ?`, [id]);
  if (!row) throw problem(404, '找不到这道菜。');
  return dishFromRow(row);
}

async function getOrder(db, id) {
  const [[row]] = await db.execute('SELECT * FROM kitchen_orders WHERE id = ?', [id]);
  return row ? orderFromRow(row) : null;
}

export function createMySqlStore(pool) {
  function editMenu(action) {
    return transaction(pool, async db => {
      await db.query("SELECT name FROM kitchen_meta WHERE name = 'category-management' FOR UPDATE");
      return action(db);
    });
  }

  async function requireCategory(db, name) {
    const [[category]] = await db.execute('SELECT id, name FROM kitchen_categories WHERE name = ?', [name]);
    if (!category) throw problem(409, '该分类已不存在，请重新选择。');
    return category;
  }

  return {
    async ping() {
      await pool.query('SELECT 1');
    },
    async session(hash) {
      const [[row]] = await pool.execute('SELECT username FROM kitchen_sessions WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP(3)', [hash]);
      return row?.username;
    },
    async startSession(hash, username, expiry, oldHash) {
      await transaction(pool, async db => {
        await db.execute('DELETE FROM kitchen_sessions WHERE expires_at <= UTC_TIMESTAMP(3)');
        if (oldHash) await db.execute('DELETE FROM kitchen_sessions WHERE token_hash = ?', [oldHash]);
        await db.execute('INSERT INTO kitchen_sessions (token_hash, username, expires_at) VALUES (?, ?, ?)', [hash, username, expiry]);
      });
    },
    async endSession(hash) {
      await pool.execute('DELETE FROM kitchen_sessions WHERE token_hash = ?', [hash]);
    },
    async state(user) {
      const isChef = user.role === 'chef';
      const [dishes, orders] = await Promise.all([
        pool.execute(`SELECT ${dishFields} FROM kitchen_dishes ${isChef ? '' : 'WHERE active = TRUE'} ORDER BY created_at, id`),
        pool.execute(`SELECT * FROM kitchen_orders ${isChef ? '' : 'WHERE customer IN (?, ?)'} ORDER BY created_at DESC, id DESC`, isChef ? [] : orderOwners(user.username)),
      ]);
      const [categories] = await pool.query('SELECT name FROM kitchen_categories ORDER BY id');
      return { user, dishes: dishes[0].map(dishFromRow), orders: orders[0].map(orderFromRow), categories: categories.map(row => row.name) };
    },
    async saveCategory(previous, name) {
      try {
        await editMenu(async db => {
          if (previous === null) {
            await db.execute('INSERT INTO kitchen_categories (name) VALUES (?)', [name]);
            return;
          }
          const category = await requireCategory(db, previous);
          await db.execute('UPDATE kitchen_categories SET name = ? WHERE id = ?', [name, category.id]);
          await db.execute('UPDATE kitchen_dishes SET category = ? WHERE category = ?', [name, category.name]);
        });
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw problem(409, '这个分类已存在。');
        throw error;
      }
    },
    async deleteCategory(name) {
      await editMenu(async db => {
        const category = await requireCategory(db, name);
        const [[dish]] = await db.execute('SELECT id FROM kitchen_dishes WHERE category = ? LIMIT 1', [category.name]);
        if (dish) throw problem(409, '请先把该分类下的菜品移到其他分类。');
        await db.execute('DELETE FROM kitchen_categories WHERE id = ?', [category.id]);
      });
    },
    async createDish(dish) {
      const id = `dish-${randomUUID()}`;
      return editMenu(async db => {
        const { name: category } = await requireCategory(db, dish.category);
        await db.execute('INSERT INTO kitchen_dishes (id, name, category, description, image, price, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [id, dish.name, category, dish.description, dish.image, dish.price, dish.active]);
        return { id, ...dish, category };
      });
    },
    async updateDish(id, dish) {
      return editMenu(async db => {
        const { name: category } = await requireCategory(db, dish.category);
        const [result] = await db.execute('UPDATE kitchen_dishes SET name = ?, category = ?, description = ?, image = ?, price = ?, active = ? WHERE id = ?',
          [dish.name, category, dish.description, dish.image, dish.price, dish.active, id]);
        if (!result.affectedRows) throw problem(404, '找不到这道菜。');
        return { id, ...dish, category };
      });
    },
    async setDishActive(id, active) {
      return transaction(pool, async db => {
        const [result] = await db.execute('UPDATE kitchen_dishes SET active = ? WHERE id = ?', [active, id]);
        if (!result.affectedRows) throw problem(404, '找不到这道菜。');
        return getDish(db, id);
      });
    },
    async deleteDish(id) {
      await pool.execute('DELETE FROM kitchen_dishes WHERE id = ?', [id]);
    },
    async createOrder(input, customer) {
      const owned = order => {
        if (!orderOwners(customer).includes(order.customer)) throw problem(409, '订单编号已被使用。');
        return order;
      };
      try {
        return await transaction(pool, async db => {
          const previous = await getOrder(db, input.id);
          if (previous) return owned(previous);

          const ids = [...new Set(input.items.map(item => item.dishId))];
          const [rows] = await db.execute(`SELECT ${dishFields} FROM kitchen_dishes WHERE id IN (${ids.map(() => '?').join(', ')}) FOR SHARE`, ids);
          const dishes = new Map(rows.map(row => [row.id, dishFromRow(row)]));
          const items = input.items.map(item => {
            const dish = dishes.get(item.dishId);
            if (!dish?.active) throw problem(409, '购物车里有已下架的菜，请移除后再提交。');
            return { ...item, name: dish.name, price: dish.price, image: dish.image.startsWith('data:') ? '' : dish.image };
          });
          const total = items.reduce((sum, item) => sum + Math.round(item.price * 100) * item.quantity, 0) / 100;
          await db.execute(`INSERT INTO kitchen_orders (id, customer, status, items, note, total, created_at, updated_at)
            VALUES (?, ?, '待制作', ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, [input.id, customer, JSON.stringify(items), input.note, total]);
          return getOrder(db, input.id);
        });
      } catch (error) {
        // An overlapping request with the same id may be committed by the time the insert fails.
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        const previous = await getOrder(pool, input.id);
        if (!previous) throw error;
        return owned(previous);
      }
    },
    async setOrderStatus(id, status) {
      return transaction(pool, async db => {
        const [result] = await db.execute('UPDATE kitchen_orders SET status = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [status, id]);
        if (!result.affectedRows) throw problem(404, '找不到这笔订单。');
        return getOrder(db, id);
      });
    },
  };
}
