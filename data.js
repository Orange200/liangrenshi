(function () {
  'use strict';

  const prefix = 'couple-kitchen:v1:';
  const sessionKey = `${prefix}session`;
  const dishPrefix = `${prefix}dish:`;
  const orderPrefix = `${prefix}order:`;
  const listeners = new Set();

  const categories = Object.freeze(['江西风味', '河南面食', '家常菜']);
  const statuses = Object.freeze(['待制作', '制作中', '已完成', '取消']);
  const accounts = [
    { username: 'customer', password: '123456', role: 'customer' },
    { username: 'chef', password: '654321', role: 'chef' },
  ];

  const seeds = [
    ['江西炒粉', '江西风味', '米粉炒得干爽入味，青红椒带一点鲜辣。', 16],
    ['爆炒花甲', '江西风味', '花甲裹着姜蒜与辣椒的香气，鲜辣开胃。', 28],
    ['炒基围虾', '江西风味', '基围虾和葱姜快炒，虾肉鲜甜弹嫩。', 38],
    ['油焖大虾', '江西风味', '大虾焖到壳红肉嫩，酱汁浓香微甜。', 48],
    ['豆角焖面', '河南面食', '豆角和肉片一起焖，面条吸足了汤汁。', 18],
    ['菜莽', '河南面食', '薄面皮卷起韭菜和鸡蛋，上锅蒸到清香软嫩。', 16],
    ['红烧排骨', '家常菜', '排骨慢烧入味，油亮的酱汁适合拌饭。', 38],
    ['玉米炖排骨', '家常菜', '排骨和甜玉米小火慢炖，汤鲜清甜。', 32],
  ].map(([name, category, description, price], index) => ({
    id: `dish-${index + 1}`,
    name,
    category,
    description,
    price,
    image: `assets/dish-${index + 1}.webp`,
    active: true,
  }));

  function read(key, fallback = null, session = false) {
    try {
      const value = (session ? window.sessionStorage : window.localStorage).getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch {
      throw new Error('无法读取本地数据，请检查浏览器的存储设置。');
    }
  }

  function write(key, value, session = false) {
    try {
      const storage = session ? window.sessionStorage : window.localStorage;
      if (value === undefined) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify(value));
    } catch {
      throw new Error('无法保存本地数据，请检查浏览器的存储权限和剩余空间。');
    }
  }

  function recordsFor(keyPrefix) {
    let keys;
    try {
      const storage = window.localStorage;
      keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    } catch {
      throw new Error('无法读取本地数据，请检查浏览器的存储设置。');
    }
    return keys.filter((key) => key?.startsWith(keyPrefix)).map((key) => read(key)).filter(Boolean);
  }

  function notify() {
    for (const listener of listeners) queueMicrotask(listener);
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  window.addEventListener('storage', (event) => {
    if (event.storageArea === window.localStorage && (event.key === null || event.key.startsWith(prefix))) {
      notify();
    }
  });

  function user() {
    const username = read(sessionKey, null, true);
    const account = accounts.find((entry) => entry.username === username);
    return account ? { username: account.username, role: account.role } : null;
  }

  function login(username, password) {
    const account = accounts.find((entry) => entry.username === String(username).trim() && entry.password === password);
    if (!account) throw new Error('账号或密码不正确，请重新输入。');
    write(sessionKey, account.username, true);
    return user();
  }

  function logout() {
    write(sessionKey, undefined, true);
  }

  function requireUser(role) {
    const account = user();
    if (!account) throw new Error('请先登录。');
    if (role && account.role !== role) throw new Error('当前账号无权执行此操作。');
    return account;
  }

  function newId() {
    return Array.from(window.crypto.getRandomValues(new Uint32Array(3)), (part) => part.toString(36)).join('-');
  }

  function allDishes() {
    const dishes = new Map(seeds.map((dish) => [dish.id, { ...dish }]));
    for (const record of recordsFor(dishPrefix)) {
      if (record.deleted) dishes.delete(record.id);
      else dishes.set(record.id, record);
    }
    return dishes;
  }

  function dishes() {
    const account = requireUser();
    return [...allDishes().values()].filter((dish) => account.role === 'chef' || dish.active);
  }

  function dishFor(id) {
    const existing = read(`${dishPrefix}${id}`) ?? seeds.find((dish) => dish.id === id);
    return existing?.deleted ? null : existing;
  }

  function noteText(value) {
    const note = String(value ?? '').trim();
    if (note.length > 500) throw new Error('备注请控制在 500 字以内。');
    return note;
  }

  function imageValue(value) {
    const image = String(value ?? '').trim();
    if (image.length > 920_000) throw new Error('图片太大，请换一张较小的图片。');
    if (!image || /^data:image\/(?:jpeg|png|gif|webp);base64,[\w+/=]+$/i.test(image)) return image;
    try {
      const { protocol } = new URL(image, document.baseURI);
      if (['file:', 'https:', 'http:'].includes(protocol)) return image;
    } catch {
      // Use the same validation message for malformed and unsupported URLs.
    }
    throw new Error('请使用有效的图片路径或上传 JPG、PNG、GIF、WebP 图片。');
  }

  function saveDish(values) {
    requireUser('chef');
    const existing = values.id ? dishFor(values.id) : null;
    if (values.id && !existing) throw new Error('这道菜已被删除。');

    const name = String(values.name ?? '').trim();
    const description = String(values.description ?? '').trim();
    const price = Number(values.price);
    if (!name || name.length > 40) throw new Error('请输入 1 到 40 字的菜品名称。');
    if (!categories.includes(values.category)) throw new Error('请选择菜品分类。');
    if (description.length > 200) throw new Error('菜品描述请控制在 200 字以内。');
    if (String(values.price ?? '').trim() === '' || !Number.isFinite(price) || price < 0 || price > 100000) {
      throw new Error('请输入 0 到 100000 元之间的参考价格。');
    }

    const dish = {
      id: existing?.id ?? `dish-${newId()}`,
      name,
      category: values.category,
      description,
      image: imageValue(values.image),
      price: Math.round(price * 100) / 100,
      active: values.active ?? existing?.active ?? true,
    };
    write(`${dishPrefix}${dish.id}`, dish);
    notify();
    return dish;
  }

  function deleteDish(id) {
    requireUser('chef');
    if (!dishFor(id)) throw new Error('这道菜已被删除。');
    const value = seeds.some((dish) => dish.id === id) ? { id, deleted: true } : undefined;
    write(`${dishPrefix}${id}`, value);
    notify();
  }

  function setDishActive(id, active) {
    requireUser('chef');
    const dish = dishFor(id);
    if (!dish) throw new Error('这道菜已被删除。');
    write(`${dishPrefix}${id}`, { ...dish, active: Boolean(active) });
    notify();
  }

  function cartKey(account) {
    return `${prefix}cart:${account.username}`;
  }

  function cartDraft(account) {
    const draft = read(cartKey(account));
    if (!draft || read(`${orderPrefix}order-${draft.revision}`)) return { items: [] };
    return draft;
  }

  function cart() {
    const account = requireUser('customer');
    return cartDraft(account).items.map((line) => {
      const dish = dishFor(line.dishId);
      return { ...line, dish: dish ?? line.dish, available: Boolean(dish?.active) };
    });
  }

  function quantityValue(quantity, min = 1) {
    const value = Number(quantity);
    if (!Number.isInteger(value) || value < min || value > 99) {
      throw new Error('菜品份数须为 1 到 99 之间的整数。');
    }
    return value;
  }

  function writeCart(account, items) {
    const draft = items.length ? { revision: newId(), items } : undefined;
    write(cartKey(account), draft);
    notify();
  }

  function snapshotImage(dish) {
    // Keep uploaded image data in its menu record to avoid duplicating large images per order.
    return dish.image.startsWith('data:') ? '' : dish.image;
  }

  function addToCart(dishId, quantity = 1, note = '') {
    const account = requireUser('customer');
    const dish = dishFor(dishId);
    if (!dish?.active) throw new Error('这道菜已下架，请选择其他菜品。');
    const items = cartDraft(account).items;
    const servings = quantityValue(quantity);
    const cleanNote = noteText(note);
    const existing = items.find((item) => item.dishId === dishId && item.note === cleanNote);
    if (existing) {
      existing.quantity = quantityValue(existing.quantity + servings);
    } else {
      items.push({
        id: newId(),
        dishId,
        quantity: servings,
        note: cleanNote,
        dish: { ...dish, image: snapshotImage(dish) },
      });
    }
    writeCart(account, items);
  }

  function updateCart(lineId, quantity, note) {
    const account = requireUser('customer');
    const items = cartDraft(account).items;
    const index = items.findIndex((line) => line.id === lineId);
    if (index === -1) throw new Error('这道菜已从购物车移除。');
    const servings = quantityValue(quantity, 0);
    if (servings === 0) {
      items.splice(index, 1);
    } else {
      items[index].quantity = servings;
      if (note !== undefined) items[index].note = noteText(note);
    }
    writeCart(account, items);
  }

  function submitOrder(note = '') {
    const account = requireUser('customer');
    const draft = cartDraft(account);
    if (!draft.items.length) throw new Error('请先把想吃的菜加入购物车。');

    const items = draft.items.map((line) => {
      const dish = dishFor(line.dishId);
      if (!dish?.active) throw new Error('购物车中有已下架的菜品，请移除后再提交。');
      return {
        dishId: dish.id,
        name: dish.name,
        price: dish.price,
        quantity: line.quantity,
        note: line.note,
        image: snapshotImage(dish),
      };
    });
    const now = new Date().toISOString();
    const order = {
      id: `order-${draft.revision}`,
      customer: account.username,
      createdAt: now,
      updatedAt: now,
      status: statuses[0],
      items,
      note: noteText(note),
      total: items.reduce((cents, line) => cents + Math.round(line.price * 100) * line.quantity, 0) / 100,
    };
    const key = `${orderPrefix}${order.id}`;
    const existing = read(key);
    if (existing) return existing;

    // The saved order makes this draft unavailable in every tab, including after a reload.
    write(key, order);
    notify();
    return order;
  }

  function orders() {
    const account = requireUser();
    return recordsFor(orderPrefix)
      .filter((order) => account.role === 'chef' || order.customer === account.username)
      .sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  }

  function setOrderStatus(id, status) {
    requireUser('chef');
    if (!statuses.includes(status)) throw new Error('请选择有效的订单状态。');
    const key = `${orderPrefix}${id}`;
    const order = read(key);
    if (!order) throw new Error('找不到这笔订单。');
    if (order.status === status) return;
    write(key, { ...order, status, updatedAt: new Date().toISOString() });
    notify();
  }

  window.Kitchen = Object.freeze({
    categories,
    statuses,
    user,
    login,
    logout,
    dishes,
    saveDish,
    deleteDish,
    setDishActive,
    cart,
    addToCart,
    updateCart,
    submitOrder,
    orders,
    setOrderStatus,
    subscribe,
  });
}());
