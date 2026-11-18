(() => {
  'use strict';

  const header = document.querySelector('#site-header');
  const main = document.querySelector('#main-content');
  const connectionNotice = document.querySelector('#connection-notice');
  const footer = document.querySelector('#site-footer');
  const dialog = document.querySelector('#app-dialog');
  const toast = document.querySelector('#toast');
  const { Kitchen } = window;
  const routes = {
    customer: ['menu', 'wheel', 'orders'],
    chef: ['kitchen-orders', 'kitchen-menu', 'history']
  };
  const navLabels = {
    menu: ['menu', '今日菜单'], wheel: ['wheel', '幸运转盘'], orders: ['receipt', '我的订单'],
    'kitchen-orders': ['receipt', '订单管理'], 'kitchen-menu': ['menu', '菜品管理'],
    history: ['clock', '历史订单']
  };
  const loginAccounts = {
    customer: { username: 'customer', roleName: '点菜人' },
    chef: { username: 'chef', roleName: '厨师' }
  };
  const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
  const priceFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
  const iconPaths = {
    brand: '<path d="M12 20.6 4.8 14C-.1 9.5 5.5 3.4 10.2 7l1.8 1.6L13.8 7c4.7-3.6 10.3 2.5 5.4 7L12 20.6Z"/><path d="M12 2.5v2M17 3.1l-1 1.6M7 3.1l1 1.6"/>',
    menu: '<path d="M4 3v6a2 2 0 0 0 4 0V3M6 3v18M19 21V3c-3 2-4 5-4 9h4"/>',
    wheel: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8m0-12.8L5.6 18.4"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    bag: '<path d="M5 8h14l1 13H4L5 8Z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/>',
    logout: '<path d="M10 4H4v16h6m4-12 4 4-4 4m4-4H9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    heart: '<path d="M12 20s-8-4.7-8-10a4.5 4.5 0 0 1 8-2.6 4.5 4.5 0 0 1 8 2.6c0 5.3-8 10-8 10Z"/>',
    sparkle: '<path d="M12 2c.7 6 3.5 8.3 9 10-5.5 1.7-8.3 4-9 10-.7-6-3.5-8.3-9-10 5.5-1.7 8.3-4 9-10Z"/>',
    chef: '<path d="M6 14c-6-1-4-9 1-9a5 5 0 0 1 10 0c5 0 7 8 1 9v6H6v-6Zm0 2h12"/>',
    note: '<path d="M5 3h14v13l-5 5H5V3Zm3 5h8M8 12h8m-2 9v-5h5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1"/><path d="m3 17 6-5 4 5 3-4 5 5"/>'
  };

  let currentRoute = '';
  let loginRole = 'customer';
  let category = '';
  let toastTimer;
  let wheelRotation = 0;
  let spinTimer;
  let lastWheelSignature = '';
  let wheelVersion = 0;
  let lastMenuSignature = '';
  let checkoutSignature = '';
  let lastOrdersSignature = '';
  let lastManageSignature = '';
  let ready = false;

  function icon(name) {
    return `<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${iconPaths[name]}</svg>`;
  }

  function escape(value = '') {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function money(value) {
    return `¥${priceFormat.format(value)}`;
  }

  function dishPhoto(dish, className = '') {
    return `<img class="${className}" src="${escape(dish.image || 'assets/hero.webp')}" alt="${escape(dish.name)}" loading="lazy">`;
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
  }

  function attempt(action) {
    try {
      action();
    } catch (error) {
      showToast(error.message);
    }
  }

  async function withPendingButton(button, action) {
    button.disabled = true;
    try {
      await action();
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  }

  function routeFor(user) {
    if (!user) return 'login';
    const requested = location.hash.slice(1);
    const allowed = routes[user.role];
    return allowed.includes(requested) ? requested : allowed[0];
  }

  function syncAddress(route) {
    if (location.hash !== `#${route}`) history.replaceState(null, '', `#${route}`);
  }

  function renderHeader(user, route) {
    const brandRoute = user ? routes[user.role][0] : 'login';
    header.innerHTML = `<div class="shell header-inner">
      <a href="#${brandRoute}" class="brand" aria-label="两人食首页">
        <span class="brand-icon">${icon('brand')}</span><span class="brand-text"><strong>两人食</strong><small>情侣私享点餐小站</small></span>
      </a>
      ${user ? `<nav class="main-nav" aria-label="主导航">${routes[user.role].map(item => `
        <a class="nav-link ${item === route ? 'is-active' : ''}" href="#${item}" ${item === route ? 'aria-current="page"' : ''}>${icon(navLabels[item][0])}<span>${navLabels[item][1]}</span></a>`).join('')}
      </nav><div class="user-menu">
        ${user.role === 'customer' ? `<button class="icon-button cart-jump" data-action="cart-jump" aria-label="打开购物车" title="购物车">${icon('bag')}<span class="cart-count" hidden></span></button>` : ''}
        <span class="role-badge">${user.role === 'chef' ? '厨师' : '点菜人'}</span>
        <button class="icon-button" data-action="logout" aria-label="退出登录" title="退出登录">${icon('logout')}</button>
      </div>` : `<span class="private-label">${icon('heart')} 私享小厨房</span>`}
    </div>`;
  }

  function renderFooter() {
    footer.innerHTML = `<div class="shell footer-inner"><span>${icon('heart')} 两人食</span><small>一日三餐，和你一起。</small></div>`;
  }

  function renderLogin() {
    const selected = loginAccounts[loginRole];
    main.innerHTML = `<section class="login-layout shell" aria-label="登录">
      <div class="login-photo">
        <img src="assets/hero.webp" alt="餐桌上的家常菜和两副碗筷" fetchpriority="high">
        <div class="login-caption"><span class="eyebrow">${icon('heart')} 两个人的餐桌</span><h1>今天，<br>一起吃饭吧。</h1></div>
      </div>
      <div class="login-panel"><div class="login-card">
        <span class="login-emblem">${icon('brand')}</span>
        <h2>欢迎回家</h2>
        <p class="login-intro">想吃什么，今天就做什么。</p>
        ${Kitchen.online ? '' : `<div class="login-tabs" aria-label="选择登录身份">
          ${Object.entries(loginAccounts).map(([role, account]) => `<button class="login-tab ${role === loginRole ? 'is-active' : ''}" data-action="login-role" data-role="${role}" aria-pressed="${role === loginRole}">${icon(role === 'chef' ? 'chef' : 'menu')} ${account.roleName}</button>`).join('')}
        </div>`}
        <form id="login-form">
          <label class="field">账号<input name="username" autocomplete="username" placeholder="请输入账号" value="${Kitchen.online ? '' : selected.username}" required></label>
          <label class="field">密码<input name="password" type="password" autocomplete="current-password" placeholder="请输入密码" required></label>
          <p class="form-error" role="alert" hidden></p>
          <button class="button primary full" type="submit">登录小厨房 ${icon('arrow')}</button>
        </form>
      </div></div>
    </section>`;
  }

  function pageHeading(title, detail, action = '') {
    return `<div class="page-heading"><div><h1>${title}</h1><p>${detail}</p></div>${action}</div>`;
  }

  function renderMenu() {
    const dishes = Kitchen.dishes();
    if (!Kitchen.categories.includes(category)) category = '';
    lastMenuSignature = JSON.stringify([dishes, Kitchen.categories]);
    const visible = dishes.filter(dish => !category || dish.category === category);
    main.innerHTML = `<section class="hero shell" aria-label="今日菜单横幅">
      <div class="hero-copy"><span class="eyebrow">${icon('heart')} 两个人的餐桌</span>
        <h1>今天想吃点什么？</h1><p>从喜欢的家常菜里挑几样。下单之后，就交给你的专属厨师。</p>
        <div class="hero-actions"><a class="button secondary" href="#wheel">${icon('sparkle')} 让转盘帮我选</a></div>
      </div><div class="hero-image"><img src="assets/hero.webp" alt="为两个人准备的家常晚餐" fetchpriority="high"></div>
    </section>
    <div class="workspace shell">
      <section class="menu-area" aria-labelledby="menu-title">
        <div class="section-heading"><div><h2 id="menu-title">今日菜单</h2><p>选好份数，还可以给厨师留一句话。</p></div></div>
        <div class="filters" aria-label="菜品分类">
          ${['', ...Kitchen.categories].map(item => `<button class="filter ${item === category ? 'is-active' : ''}" data-action="filter" data-category="${escape(item)}" aria-pressed="${item === category}">${escape(item || '全部菜品')}</button>`).join('')}
        </div>
        ${visible.length ? `<div class="dish-grid">${visible.map(dish => `<article class="dish-card">
          <div class="dish-image">${dishPhoto(dish)}<span class="dish-category">${escape(dish.category)}</span></div>
          <div class="dish-body"><h3>${escape(dish.name)}</h3><p>${escape(dish.description)}</p>
            <div class="dish-footer"><span class="dish-price">${money(dish.price)}<small> / 份</small></span>
              <button type="button" class="add-button" data-action="choose-dish" data-id="${escape(dish.id)}" aria-label="选择${escape(dish.name)}" title="选择${escape(dish.name)}">${icon('plus')}</button>
            </div>
          </div>
        </article>`).join('')}</div>` : emptyState('menu', '这一栏暂时没有可以点的菜。')}
      </section>
      <aside class="cart-panel" id="cart-panel" aria-labelledby="cart-title" tabindex="-1"></aside>
    </div>`;
    renderCart();
  }

  function emptyState(symbol, message) {
    return `<div class="empty-state"><span class="empty-icon">${icon(symbol)}</span><p>${message}</p></div>`;
  }

  function renderCart() {
    const lines = Kitchen.cart();
    const count = lines.reduce((sum, line) => sum + line.quantity, 0);
    const countBadge = header.querySelector('.cart-count');
    if (countBadge) {
      countBadge.textContent = count;
      countBadge.hidden = !count;
    }

    const panel = document.querySelector('#cart-panel');
    if (!panel) return;
    const focused = panel.contains(document.activeElement) ? document.activeElement.dataset : {};
    const total = lines.reduce((sum, line) => sum + line.dish.price * line.quantity, 0);
    const allAvailable = lines.every(line => line.available);
    panel.innerHTML = `<div class="cart-head"><span class="cart-mark">${icon('bag')}</span><h2 id="cart-title">购物车</h2><span class="cart-quantity">${count} 份</span></div>
      ${lines.length ? `<div class="cart-lines">${lines.map(line => `<div class="cart-line">
        <span class="cart-thumb">${dishPhoto(line.dish)}</span>
        <div class="cart-line-main"><strong>${escape(line.dish.name)}</strong>
          ${line.available ? `<span>${money(line.dish.price)} / 份</span>` : '<span class="unavailable">已下架，请移除</span>'}
          ${line.note ? `<small>${escape(line.note)}</small>` : ''}
          <button class="note-button" data-action="${line.available ? 'line-note' : 'remove-line'}" data-id="${escape(line.id)}">${line.available ? (line.note ? '修改备注' : '加备注') : '从购物车移除'}</button>
        </div>
        ${line.available ? `<div class="stepper" aria-label="${escape(line.dish.name)}份数">
          <button data-action="decrease" data-id="${escape(line.id)}" aria-label="减少一份">${icon('minus')}</button>
          <span>${line.quantity}</span>
          <button data-action="increase" data-id="${escape(line.id)}" aria-label="增加一份" ${line.quantity >= 99 ? 'disabled' : ''}>${icon('plus')}</button>
        </div>` : ''}
      </div>`).join('')}</div>` : `<div class="cart-empty"><span class="empty-icon">${icon('bag')}</span><strong>还没有选菜</strong><p>喜欢的菜，先放进这里。</p></div>`}
      <div class="cart-total"><span>参考合计</span><strong>${money(total)}</strong></div>
      <button class="button primary full cart-checkout" data-action="checkout" ${!lines.length || !allAvailable ? 'disabled' : ''}>去下单 ${icon('arrow')}</button>`;

    if (focused.action && focused.id) {
      const replacement = [...panel.querySelectorAll('button')].find(button => button.dataset.action === focused.action && button.dataset.id === focused.id);
      if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
    }
  }

  function jumpToCart() {
    const panel = document.querySelector('#cart-panel');
    if (panel) {
      panel.scrollIntoView({ block: 'nearest' });
      panel.focus({ preventScroll: true });
    } else {
      location.hash = 'menu';
      window.addEventListener('hashchange', () => requestAnimationFrame(jumpToCart), { once: true });
    }
  }

  function orderCard(order, canManage) {
    const inactive = order.status === '已完成' || order.status === '取消';
    return `<article class="order-card">
      <div class="order-header"><div><h2>订单 ${escape(order.id.slice(-6).toUpperCase())}</h2><time datetime="${escape(order.createdAt)}">${dateFormat.format(new Date(order.createdAt))}</time></div>
        <span class="status-badge" data-status="${escape(order.status)}">${escape(order.status)}</span></div>
      <ul class="order-items">${order.items.map(item => `<li><div><strong>${escape(item.name)}</strong>${item.note ? `<small>${escape(item.note)}</small>` : ''}</div><span>× ${item.quantity}</span><span>${money(item.price * item.quantity)}</span></li>`).join('')}</ul>
      ${order.note ? `<p class="order-note">${icon('note')} <strong>整单备注</strong> ${escape(order.note)}</p>` : ''}
      <div class="order-footer"><span>参考合计 <strong>${money(order.total)}</strong></span>
        ${canManage ? `<button class="button secondary" data-action="order-status" data-id="${escape(order.id)}">${inactive ? '调整状态' : '更新状态'}</button>` : ''}</div>
    </article>`;
  }

  function renderOrders(route) {
    const isChef = route !== 'orders';
    let orders = Kitchen.orders();
    lastOrdersSignature = JSON.stringify(orders);
    const historicalStatus = status => ['已完成', '取消'].includes(status);
    if (isChef) orders = orders.filter(order => historicalStatus(order.status) === (route === 'history'));
    const heading = {
      orders: ['我的订单', '在这里查看下单记录和厨师更新的状态。', '还没有下单。'],
      'kitchen-orders': ['订单管理', '查看点菜人的新订单，更新制作进度。', '现在没有待处理的订单。'],
      history: ['历史订单', '查看已完成或已取消的订单。', '还没有历史订单。']
    }[route];
    main.innerHTML = `<section class="page-content shell">${pageHeading(heading[0], heading[1])}
      ${orders.length ? `<div class="order-list">${orders.map(order => orderCard(order, isChef)).join('')}</div>` : emptyState('receipt', heading[2])}
    </section>`;
  }

  function renderManage() {
    const dishes = Kitchen.dishes();
    lastManageSignature = JSON.stringify(dishes);
    main.innerHTML = `<section class="page-content shell">
      ${pageHeading('菜品管理', '编辑菜单，决定今天有哪些菜可以点。', `<button class="button primary" data-action="new-dish">${icon('plus')} 新增菜品</button>`)}
      <div class="admin-toolbar"><strong>全部菜品</strong>${Kitchen.saveCategory ? '<button class="button secondary" data-action="categories">分类管理</button>' : ''}<span>${dishes.length} 道 · ${dishes.filter(dish => dish.active).length} 道已上架</span></div>
      ${dishes.length ? `<div class="manage-list">${dishes.map(dish => `<article class="manage-row">
        <div class="manage-thumb">${dishPhoto(dish)}</div>
        <div class="manage-detail"><h2>${escape(dish.name)}</h2><p>${escape(dish.category)} · ${money(dish.price)} / 份</p></div>
        <span class="status-badge" data-status="${dish.active ? '已上架' : '已下架'}">${dish.active ? '已上架' : '已下架'}</span>
        <div class="row-actions">
          <button class="button secondary" data-action="edit-dish" data-id="${escape(dish.id)}">编辑</button>
          <button class="button secondary" data-action="toggle-dish" data-id="${escape(dish.id)}">${dish.active ? '下架' : '上架'}</button>
          <button class="button ghost" data-action="delete-dish" data-id="${escape(dish.id)}">删除</button>
        </div>
      </article>`).join('')}</div>` : emptyState('menu', '还没有菜品，新增一道试试。')}
    </section>`;
  }

  function wheelSignature(dishes) {
    return JSON.stringify(dishes.map(({ id, name }) => [id, name]));
  }

  function drawWheel(dishes) {
    const canvas = document.querySelector('.wheel');
    if (!canvas || !dishes.length) return;
    const context = canvas.getContext('2d');
    const center = canvas.width / 2;
    const radius = center - 12;
    const start = -Math.PI / 2;
    const slice = (Math.PI * 2) / dishes.length;
    const colors = ['#f5c5cc', '#fce9db', '#f8d9df', '#f3decf', '#edacba', '#ffe5e2', '#f2d2c3', '#f6e5ee'];
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.translate(center, center);
    dishes.forEach((dish, index) => {
      const begin = start + index * slice;
      const end = begin + slice;
      context.beginPath();
      context.moveTo(0, 0);
      context.arc(0, 0, radius, begin, end);
      context.closePath();
      context.fillStyle = colors[index % colors.length];
      context.fill();
      if (dishes.length > 1) {
        context.strokeStyle = '#fff8f5';
        context.lineWidth = 4;
        context.stroke();
      }
      context.save();
      const angle = dishes.length === 1 ? start : begin + slice / 2;
      context.rotate(angle);
      context.translate(radius * .9, 0);
      const flip = Math.cos(angle) < 0;
      if (flip) context.rotate(Math.PI);
      context.textAlign = flip ? 'left' : 'right';
      context.textBaseline = 'middle';
      context.fillStyle = '#642936';
      context.font = `600 ${dishes.length > 12 ? 18 : 24}px "Microsoft YaHei", sans-serif`;
      context.fillText(dish.name.length > 9 ? `${dish.name.slice(0, 8)}…` : dish.name, 0, 0, radius * .56);
      context.restore();
    });
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.strokeStyle = '#fffaf8';
    context.lineWidth = 8;
    context.stroke();
    context.restore();
  }

  function stopSpin() {
    clearTimeout(spinTimer);
    spinTimer = undefined;
    wheelVersion += 1;
  }

  function renderWheel(dishes = Kitchen.dishes()) {
    lastWheelSignature = wheelSignature(dishes);
    wheelRotation = 0;
    main.innerHTML = `<section class="page-content shell">
      ${pageHeading('幸运转盘', '每道已上架的菜都有机会被选中。')}
      ${dishes.length ? `<div class="wheel-layout"><div class="wheel-stage">
        <div class="wheel-pointer" aria-hidden="true"></div><canvas class="wheel" width="640" height="640" aria-label="${escape(dishes.map(dish => dish.name).join('、'))}"></canvas>
        <span class="wheel-hub" aria-hidden="true">${icon('heart')}</span>
      </div><div class="wheel-copy"><span class="empty-icon">${icon('sparkle')}</span><h2>今天吃什么？</h2>
        <p>转一下，随机选一道。喜欢的话就放进购物车。</p>
        <button class="button primary" data-action="spin">${icon('wheel')} 开始转动</button></div></div>` : emptyState('wheel', '现在没有已上架的菜，等厨师准备好菜单再来转吧。')}
    </section>`;
    drawWheel(dishes);
  }

  function spinWheel() {
    if (spinTimer !== undefined) return;
    const dishes = Kitchen.dishes();
    if (!dishes.length) return renderWheel(dishes);
    if (wheelSignature(dishes) !== lastWheelSignature) renderWheel(dishes);
    const button = main.querySelector('[data-action="spin"]');
    const canvas = main.querySelector('.wheel');
    const index = Math.floor(Math.random() * dishes.length);
    const pick = dishes[index];
    const slice = 360 / dishes.length;
    const desired = ((-(index + .5) * slice) % 360 + 360) % 360;
    const delta = (desired - (wheelRotation % 360) + 360) % 360;
    wheelRotation += 360 * 5 + delta;
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 3100;
    canvas.style.transition = duration ? `transform ${duration}ms cubic-bezier(.13,.67,.12,1)` : 'none';
    canvas.style.transform = `rotate(${wheelRotation}deg)`;
    button.disabled = true;
    button.textContent = '转动中…';
    const version = ++wheelVersion;
    spinTimer = setTimeout(() => attempt(() => {
      if (currentRoute !== 'wheel' || version !== wheelVersion) return;
      spinTimer = undefined;
      button.disabled = false;
      button.innerHTML = `${icon('wheel')} 再转一次`;
      const dish = Kitchen.dishes().find(item => item.id === pick.id);
      if (!dish) {
        showToast('这道菜刚刚下架了，可以再转一次。');
        return;
      }
      openDialog('转到这道菜啦', `<div class="result-dish">${dishPhoto(dish)}<div><h3>${escape(dish.name)}</h3><p>${escape(dish.description)}</p><strong>${money(dish.price)} / 份</strong></div></div>`,
        `<button class="button secondary" data-action="close-dialog">先看看</button><button class="button primary" data-action="wheel-add" data-id="${escape(dish.id)}">${icon('plus')} 加入购物车</button>`);
    }), duration);
  }

  function openDialog(title, content, actions, formName = '') {
    const panel = `<div class="dialog-head"><h2 id="dialog-title">${escape(title)}</h2><button type="button" class="icon-button" data-action="close-dialog" aria-label="关闭">${icon('close')}</button></div>
      <div class="dialog-body">${content}${formName ? '<p class="form-error" role="alert" hidden></p>' : ''}</div><div class="dialog-actions">${actions}</div>`;
    dialog.innerHTML = formName ? `<form data-dialog-form="${formName}">${panel}</form>` : panel;
    if (!dialog.open) dialog.showModal();
  }

  function cancelButton(label = '返回') {
    return `<button type="button" class="button secondary" data-action="close-dialog">${label}</button>`;
  }

  function noteField(label, value = '') {
    return `<label class="field">${label}<textarea name="note" rows="3" maxlength="500" placeholder="例如：少辣、多蒜">${escape(value)}</textarea></label>`;
  }

  function chooseDish(id) {
    const dish = Kitchen.dishes().find(item => item.id === id);
    if (!dish) return showToast('这道菜已经下架。');
    openDialog(dish.name, `<input name="id" type="hidden" value="${escape(id)}">
      <div class="result-dish quantity-dish">${dishPhoto(dish)}<div><p>${escape(dish.description)}</p><strong>${money(dish.price)} / 份</strong></div></div>
      <div class="quantity-control"><label for="dish-quantity">份数</label><div class="stepper">
        <button type="button" data-action="quantity-down" aria-label="减少一份">${icon('minus')}</button><input id="dish-quantity" name="quantity" type="number" min="1" max="99" step="1" value="1" required><button type="button" data-action="quantity-up" aria-label="增加一份">${icon('plus')}</button>
      </div></div>${noteField('单品备注（可选）')}`, `${cancelButton()}<button class="button primary" type="submit">加入购物车</button>`, 'add-dish');
  }

  function editLine(id) {
    const line = Kitchen.cart().find(item => item.id === id);
    if (!line) return showToast('购物车里已没有这一项。');
    openDialog(`${line.dish.name} · 备注`, `<input name="id" type="hidden" value="${escape(id)}">${noteField('单品备注', line.note)}`,
      `${cancelButton()}<button class="button primary" type="submit">保存备注</button>`, 'line-note');
  }

  function checkout() {
    const lines = Kitchen.cart();
    if (!lines.length || lines.some(line => !line.available)) return;
    checkoutSignature = summarizeCart(lines);
    const servings = lines.reduce((sum, line) => sum + line.quantity, 0);
    const total = lines.reduce((sum, line) => sum + line.dish.price * line.quantity, 0);
    openDialog('确认下单', `<p class="notice">共 ${servings} 份 · 参考合计 ${money(total)}</p>${noteField('给厨师的整单备注（可选）')}`,
      `${cancelButton('继续点菜')}<button class="button primary" type="submit">确认下单 ${icon('arrow')}</button>`, 'checkout');
  }

  function summarizeCart(lines) {
    return JSON.stringify(lines.map(line => [line.id, line.quantity, line.note, line.dish.name, line.dish.price, line.available]));
  }

  function categoryEditor() {
    openDialog('分类管理', `<label class="field">现有分类<select name="previous"><option value="">新增分类</option>${Kitchen.categories.map(name => `<option value="${escape(name)}">${escape(name)}</option>`).join('')}</select></label>
      <label class="field">分类名称<input name="name" maxlength="24" placeholder="填写新名称" required></label>`,
    `<button class="button primary" type="submit">保存分类</button><button class="button secondary" data-delete-category type="submit" formnovalidate>删除所选分类</button>`, 'categories');
  }

  function dishEditor(id) {
    if (!Kitchen.categories.length) return showToast('请先到分类管理新增一个分类。');
    const dish = id ? Kitchen.dishes().find(item => item.id === id) : null;
    if (id && !dish) return showToast('找不到这道菜。');
    openDialog(dish ? '编辑菜品' : '新增菜品', `<input name="id" type="hidden" value="${escape(id || '')}">
      <div class="form-grid"><label class="field">菜名<input name="name" maxlength="40" value="${escape(dish?.name)}" required></label>
        <label class="field">分类<select name="category">${Kitchen.categories.map(item => `<option ${dish?.category === item ? 'selected' : ''}>${escape(item)}</option>`).join('')}</select></label></div>
      <label class="field">简短描述<textarea name="description" maxlength="200" rows="2">${escape(dish?.description)}</textarea></label>
      <div class="form-grid"><label class="field">参考价格（元）<input name="price" type="number" min="0" max="100000" step="0.01" value="${dish?.price ?? ''}" required></label>
        <label class="check-field"><input name="active" type="checkbox" ${dish?.active !== false ? 'checked' : ''}> 上架，允许点单</label></div>
      <div class="image-picker">${dish?.image ? dishPhoto(dish, 'editor-preview') : ''}
        <div><label class="field">上传菜品图片<input name="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>
        <details><summary>使用图片路径或网址</summary><label class="field"><span class="visually-hidden">图片路径或网址</span><input name="image" maxlength="2048" value="${escape(dish?.image?.startsWith('data:') ? '' : dish?.image)}" placeholder="${Kitchen.online ? '请输入 HTTPS 图片网址' : '例如 assets/my-dish.webp'}"></label></details>
        ${dish?.image ? '<label class="check-field"><input name="remove-image" type="checkbox"> 移除当前图片</label>' : ''}</div></div>`,
      `${cancelButton()}<button class="button primary" type="submit">保存菜品</button>`, 'save-dish');
  }

  function deleteDishDialog(id) {
    const dish = Kitchen.dishes().find(item => item.id === id);
    if (!dish) return showToast('找不到这道菜。');
    openDialog('删除菜品', `<input name="id" type="hidden" value="${escape(id)}"><p>确定删除「${escape(dish.name)}」？</p>`,
      `${cancelButton()}<button class="button danger" type="submit">删除菜品</button>`, 'delete-dish');
  }

  function editStatus(id) {
    const order = Kitchen.orders().find(item => item.id === id);
    if (!order) return showToast('找不到这笔订单。');
    openDialog('更新订单状态', `<input name="id" type="hidden" value="${escape(id)}"><label class="field">订单状态<select name="status">${Kitchen.statuses.map(status => `<option ${order.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select></label>`,
      `${cancelButton()}<button class="button primary" type="submit">保存状态</button>`, 'order-status');
  }

  async function uploadImage(file) {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('请选择 JPG、PNG、GIF 或 WebP 图片。');
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      const ratio = Math.min(1, 720 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/webp', .82);
    } catch {
      throw new Error('无法读取这张图片，请试试另一张。');
    } finally {
      bitmap?.close();
    }
  }

  function navigate() {
    if (!ready) return;
    const user = Kitchen.user();
    connectionNotice.hidden = !user || !Kitchen.connectionProblem?.();
    const route = routeFor(user);
    syncAddress(route);
    if (route === currentRoute) return;
    if (dialog.open) dialog.close();
    stopSpin();
    currentRoute = route;
    renderHeader(user, route);
    if (route === 'login') renderLogin();
    else if (route === 'menu') renderMenu();
    else if (route === 'wheel') renderWheel();
    else if (route === 'kitchen-menu') renderManage();
    else renderOrders(route);
    if (user?.role === 'customer' && route !== 'menu') renderCart();
    window.scrollTo(0, 0);
  }

  function refreshData() {
    if (!ready) return;
    const user = Kitchen.user();
    connectionNotice.hidden = !user || !Kitchen.connectionProblem?.();
    if (routeFor(user) !== currentRoute) {
      category = '';
      navigate();
      return;
    }
    if (currentRoute === 'menu') {
      if (JSON.stringify([Kitchen.dishes(), Kitchen.categories]) !== lastMenuSignature) renderMenu();
      else renderCart();
    } else if (currentRoute === 'wheel') {
      const dishes = Kitchen.dishes();
      if (wheelSignature(dishes) !== lastWheelSignature) {
        const wasSpinning = spinTimer !== undefined;
        stopSpin();
        renderWheel(dishes);
        if (wasSpinning) showToast('菜单刚刚更新了，请重新转一次。');
      }
      renderCart();
    } else if (currentRoute === 'kitchen-menu') {
      if (JSON.stringify(Kitchen.dishes()) !== lastManageSignature) renderManage();
    } else if (currentRoute !== 'login') {
      if (JSON.stringify(Kitchen.orders()) !== lastOrdersSignature) renderOrders(currentRoute);
      if (currentRoute === 'orders') renderCart();
    }
  }

  function changeLine(id, amount) {
    const line = Kitchen.cart().find(item => item.id === id);
    if (!line) throw new Error('购物车里已没有这一项。');
    Kitchen.updateCart(id, amount === 0 ? 0 : line.quantity + amount);
  }

  function showFormError(form, message) {
    const messageElement = form.querySelector('.form-error');
    messageElement.textContent = message;
    messageElement.hidden = !message;
  }

  function handleClick(button) {
    const { action, id, role } = button.dataset;
    const form = button.closest('form');
    switch (action) {
      case 'retry-connection': start(); break;
      case 'login-role': {
        if (role === loginRole) break;
        loginRole = role;
        renderLogin();
        main.querySelector('.login-tab.is-active').focus({ preventScroll: true });
        break;
      }
      case 'logout':
        withPendingButton(button, async () => {
          loginRole = Kitchen.user().role;
          await Kitchen.logout();
          category = '';
          navigate();
          showToast('已退出登录');
        });
        break;
      case 'cart-jump': jumpToCart(); break;
      case 'filter': {
        category = button.dataset.category;
        const scroll = scrollY;
        renderMenu();
        main.querySelector('.filter.is-active').focus({ preventScroll: true });
        window.scrollTo(0, scroll);
        break;
      }
      case 'choose-dish': chooseDish(id); break;
      case 'quantity-down':
      case 'quantity-up': {
        const input = form.elements.quantity;
        const delta = action === 'quantity-up' ? 1 : -1;
        input.value = Math.max(1, Math.min(99, (Number(input.value) || 1) + delta));
        break;
      }
      case 'line-note': editLine(id); break;
      case 'remove-line': changeLine(id, 0); break;
      case 'decrease': changeLine(id, -1); break;
      case 'increase': changeLine(id, 1); break;
      case 'checkout': checkout(); break;
      case 'spin': spinWheel(); break;
      case 'wheel-add':
        Kitchen.addToCart(id);
        dialog.close();
        showToast('已加入购物车');
        break;
      case 'new-dish': dishEditor(); break;
      case 'categories': categoryEditor(); break;
      case 'edit-dish': dishEditor(id); break;
      case 'delete-dish': deleteDishDialog(id); break;
      case 'toggle-dish': {
        const dish = Kitchen.dishes().find(item => item.id === id);
        if (!dish) throw new Error('找不到这道菜。');
        withPendingButton(button, async () => {
          await Kitchen.setDishActive(id, !dish.active);
          showToast(dish.active ? '菜品已下架' : '菜品已上架');
        });
        break;
      }
      case 'order-status': editStatus(id); break;
      case 'close-dialog': dialog.close(); break;
    }
  }

  async function submitDialog(form, submitter) {
    const values = new FormData(form);
    const id = values.get('id');
    const note = values.get('note');
    switch (form.dataset.dialogForm) {
      case 'categories': {
        const previous = values.get('previous') || undefined;
        if (submitter?.hasAttribute('data-delete-category')) {
          if (!previous) throw new Error('请先选择要删除的分类。');
          await Kitchen.deleteCategory(previous);
        } else {
          await Kitchen.saveCategory(previous, values.get('name'));
        }
        categoryEditor();
        return;
      }
      case 'add-dish':
        Kitchen.addToCart(id, Number(values.get('quantity')), note);
        showToast('已加入购物车');
        break;
      case 'line-note': {
        const item = Kitchen.cart().find(line => line.id === id);
        if (!item) throw new Error('购物车里已没有这一项。');
        Kitchen.updateCart(id, item.quantity, note);
        showToast('备注已保存');
        break;
      }
      case 'checkout':
        if (checkoutSignature !== summarizeCart(Kitchen.cart())) throw new Error('购物车已更新，请返回确认菜品后重新下单。');
        await Kitchen.submitOrder(note);
        location.hash = 'orders';
        showToast('下单成功，厨师可以接单啦');
        break;
      case 'save-dish': {
        const file = values.get('file');
        const existing = id ? Kitchen.dishes().find(dish => dish.id === id) : null;
        const keepUpload = existing?.image?.startsWith('data:') ? existing.image : '';
        let image = values.get('remove-image') ? '' : values.get('image').trim() || keepUpload;
        if (file.size) image = await uploadImage(file);
        if (!dialog.open || !dialog.contains(form)) return;
        await Kitchen.saveDish({ id: id || undefined, name: values.get('name'), category: values.get('category'),
          description: values.get('description'), price: values.get('price'), active: values.has('active'), image });
        showToast('菜品已保存');
        break;
      }
      case 'delete-dish':
        await Kitchen.deleteDish(id);
        showToast('菜品已删除');
        break;
      case 'order-status':
        await Kitchen.setOrderStatus(id, values.get('status'));
        showToast('订单状态已更新');
        break;
    }
    if (dialog.open && dialog.contains(form)) dialog.close();
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (button && !button.disabled) attempt(() => handleClick(button));
    if (event.target.matches('.skip-link')) {
      event.preventDefault();
      main.focus();
    }
  });

  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!form.matches('#login-form, [data-dialog-form]')) return;
    event.preventDefault();
    const button = event.submitter || form.querySelector('button[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    showFormError(form, '');
    try {
      if (form.id === 'login-form') {
        const { username, password } = form.elements;
        const user = await Kitchen.login(username.value, password.value);
        loginRole = user.role;
        navigate();
      } else {
        await submitDialog(form, event.submitter);
      }
    } catch (error) {
      showFormError(form, error.message);
    } finally {
      button.disabled = false;
    }
  });

  document.addEventListener('error', event => {
    const target = event.target;
    if (target instanceof HTMLImageElement && !target.dataset.fallback) {
      target.dataset.fallback = 'true';
      target.src = 'assets/hero.webp';
    }
  }, true);

  window.addEventListener('hashchange', () => attempt(navigate));

  async function start() {
    try {
      if (!Kitchen) throw new Error('未能载入页面，请刷新后重试。');
      if (Kitchen.online) {
        renderHeader(null, 'login');
        main.innerHTML = `<section class="page-content shell" aria-live="polite">${pageHeading('正在连接小厨房', '请稍候。')}</section>`;
        try {
          await Kitchen.refresh();
        } catch (error) {
          // The login form can make a fresh request after a failed session check.
          ready = true;
          currentRoute = '';
          navigate();
          showFormError(main.querySelector('#login-form'), error.message);
          return;
        }
      }
      ready = true;
      currentRoute = '';
      navigate();
    } catch (error) {
      ready = false;
      main.innerHTML = `<section class="page-content shell" role="alert">${pageHeading('暂时无法打开小厨房', escape(error.message),
        '<button class="button secondary" data-action="retry-connection">重试</button>')}</section>`;
    }
  }

  Kitchen?.subscribe(() => attempt(refreshData));
  renderFooter();
  start();
})();
