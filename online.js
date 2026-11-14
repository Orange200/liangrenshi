(() => {
  'use strict';

  const categories = Object.freeze(['江西风味', '河南面食', '家常菜']);
  const statuses = Object.freeze(['待制作', '制作中', '已完成', '取消']);
  const listeners = new Set();
  const draftPrefix = 'couple-kitchen:online-cart:';
  const signedOut = { user: null, dishes: [], orders: [] };
  let state = signedOut;
  let etag = '';
  let connectionProblem = false;
  let refreshRequest;
  let changing = false;
  let revision = 0;

  function notify() {
    for (const listener of listeners) queueMicrotask(listener);
  }

  function setConnectionProblem(value) {
    if (connectionProblem === value) return;
    connectionProblem = value;
    notify();
  }

  async function request(path, { method = 'GET', body, headers = {} } = {}) {
    let response;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 65_000) : null;
    try {
      response = await fetch(`/api/${path}`, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller?.signal,
        headers: { Accept: 'application/json', ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch {
      throw new Error('暂时无法连接小厨房，请检查网络后重试。');
    } finally {
      clearTimeout(timeout);
    }
    if (response.status === 304) return { unchanged: true };
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      const error = new Error(response.status < 500 && data?.message ? data.message : '小厨房暂时无法响应，请稍后重试。');
      error.status = response.status;
      throw error;
    }
    return { data, etag: response.headers.get('etag') || '' };
  }

  function validateState(data) {
    if (!data.user || !['chef', 'customer'].includes(data.user.role) || typeof data.user.username !== 'string' ||
        !Array.isArray(data.dishes) || !Array.isArray(data.orders)) {
      throw new Error('无法读取小厨房的数据，请重新连接。');
    }
    return data;
  }

  function acceptState(next) {
    if (JSON.stringify(state) !== JSON.stringify(next)) {
      state = next;
      notify();
    }
  }

  async function loadState(requestTag = '') {
    try {
      return await request('state', { headers: requestTag ? { 'If-None-Match': requestTag } : {} });
    } catch (error) {
      if (error.status === 401) return { data: signedOut, etag: '' };
      throw error;
    }
  }

  function refresh() {
    if (changing) return Promise.resolve();
    if (refreshRequest) return refreshRequest;
    const currentRevision = revision;
    refreshRequest = (async () => {
      try {
        const result = await loadState(etag);
        if (currentRevision !== revision) return;
        if (!result.unchanged) {
          acceptState(result.data === signedOut ? signedOut : validateState(result.data));
          etag = result.etag;
        }
        setConnectionProblem(false);
      } catch (error) {
        if (currentRevision !== revision) return;
        setConnectionProblem(true);
        throw error;
      } finally {
        refreshRequest = undefined;
      }
    })();
    return refreshRequest;
  }

  async function change(action) {
    if (changing) throw new Error('请求正在处理中，请稍等。');
    changing = true;
    revision += 1;
    try {
      const result = await action();
      setConnectionProblem(false);
      return result;
    } catch (error) {
      if (!error.status || error.status >= 500) setConnectionProblem(true);
      throw error;
    } finally {
      changing = false;
      revision += 1;
      etag = '';
    }
  }

  async function login(username, password) {
    return change(async () => {
      await request('login', { method: 'POST', body: { username: username.trim(), password } });
      const result = await loadState();
      if (result.data === signedOut) throw new Error('未能建立登录会话，请检查浏览器是否允许 Cookie。');
      acceptState(validateState(result.data));
      return state.user;
    });
  }

  async function logout() {
    return change(async () => {
      try {
        await request('logout', { method: 'POST', body: {} });
      } catch (error) {
        if (error.status !== 401) throw error;
      }
      acceptState(signedOut);
    });
  }

  function requireRole(role) {
    if (!state.user) throw new Error('请先登录。');
    if (state.user.role !== role) throw new Error('当前账号无权执行此操作。');
    return state.user;
  }

  async function mutate(path, method, body, apply) {
    return change(async () => {
      try {
        const { data } = await request(path, { method, body });
        apply(data);
        return data;
      } catch (error) {
        if (error.status === 401) acceptState(signedOut);
        throw error;
      }
    });
  }

  function withDish(dish) {
    const dishes = state.dishes.map(item => item.id === dish.id ? dish : item);
    if (!dishes.some(item => item.id === dish.id)) dishes.push(dish);
    acceptState({ ...state, dishes });
  }

  function saveDish({ id, ...fields }) {
    requireRole('chef');
    const values = { ...fields, price: Number(fields.price) };
    if (id) return mutate(`dishes/${encodeURIComponent(id)}`, 'PUT', values, withDish);
    return mutate('dishes', 'POST', values, withDish);
  }

  function deleteDish(id) {
    requireRole('chef');
    return mutate(`dishes/${encodeURIComponent(id)}`, 'DELETE', {}, () => {
      acceptState({ ...state, dishes: state.dishes.filter(dish => dish.id !== id) });
    });
  }

  function setDishActive(id, active) {
    requireRole('chef');
    return mutate(`dishes/${encodeURIComponent(id)}`, 'PATCH', { active }, withDish);
  }

  function withOrder(order) {
    const orders = state.orders.map(item => item.id === order.id ? order : item);
    if (!orders.some(item => item.id === order.id)) orders.unshift(order);
    acceptState({ ...state, orders });
  }

  function setOrderStatus(id, status) {
    requireRole('chef');
    return mutate(`orders/${encodeURIComponent(id)}`, 'PATCH', { status }, withOrder);
  }

  function cartDraft() {
    const { username } = requireRole('customer');
    try {
      const value = JSON.parse(sessionStorage.getItem(draftPrefix + username));
      if (value && !state.orders.some(order => order.id === value.id)) return value;
      return { items: [] };
    } catch {
      throw new Error('无法读取购物车，请检查浏览器的存储设置。');
    }
  }

  function newId() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function writeCart(items) {
    const { username } = requireRole('customer');
    if (changing) throw new Error('请求正在处理中，请稍等。');
    try {
      if (items.length) {
        sessionStorage.setItem(draftPrefix + username, JSON.stringify({ id: newId(), items }));
      } else {
        sessionStorage.removeItem(draftPrefix + username);
      }
    } catch {
      throw new Error('无法保存购物车，请检查浏览器的存储设置。');
    }
    notify();
  }

  function cart() {
    return cartDraft().items.map(line => {
      const dish = state.dishes.find(item => item.id === line.dishId);
      return { ...line, dish: dish ?? line.dish, available: dish?.active === true };
    });
  }

  function checkedQuantity(value) {
    if (!Number.isInteger(value) || value < 1 || value > 99) throw new Error('菜品份数须为 1 到 99 之间的整数。');
    return value;
  }

  function cleanNote(value) {
    const note = String(value ?? '').trim();
    if (note.length > 500) throw new Error('备注请控制在 500 字以内。');
    return note;
  }

  function addToCart(dishId, quantity = 1, note = '') {
    const { items } = cartDraft();
    const dish = state.dishes.find(item => item.id === dishId && item.active);
    if (!dish) throw new Error('这道菜已下架，请选择其他菜品。');
    const trimmedNote = cleanNote(note);
    const servings = checkedQuantity(quantity);
    const matching = items.find(line => line.dishId === dishId && line.note === trimmedNote);
    if (matching) {
      matching.quantity = checkedQuantity(matching.quantity + servings);
    } else {
      if (items.length >= 50) throw new Error('一笔订单最多包含 50 项菜品。');
      const preview = { name: dish.name, price: dish.price, image: dish.image?.startsWith('data:') ? '' : dish.image };
      items.push({ id: newId(), dishId, quantity: servings, note: trimmedNote, dish: preview });
    }
    writeCart(items);
  }

  function updateCart(id, quantity, note) {
    const { items } = cartDraft();
    const index = items.findIndex(line => line.id === id);
    if (index < 0) throw new Error('购物车里已没有这一项。');
    if (quantity === 0) {
      items.splice(index, 1);
    } else {
      items[index].quantity = checkedQuantity(quantity);
      if (note !== undefined) items[index].note = cleanNote(note);
    }
    writeCart(items);
  }

  function submitOrder(note) {
    const draft = cartDraft();
    if (!draft.items.length) throw new Error('请先把想吃的菜加入购物车。');
    const items = draft.items.map(({ dishId, quantity, note }) => ({ dishId, quantity, note }));
    return mutate('orders', 'POST', { id: draft.id, items, note: cleanNote(note) }, withOrder);
  }

  function poll() {
    if (!document.hidden && state.user) refresh().catch(() => {});
  }

  window.addEventListener('focus', poll);
  window.addEventListener('online', poll);
  document.addEventListener('visibilitychange', poll);
  setInterval(poll, 3000);

  window.Kitchen = Object.freeze({
    online: true, categories, statuses, login, logout, refresh,
    connectionProblem: () => connectionProblem,
    user: () => state.user,
    dishes: () => state.dishes,
    orders: () => state.orders,
    cart, addToCart, updateCart, submitOrder, saveDish, deleteDish, setDishActive, setOrderStatus,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });
})();
