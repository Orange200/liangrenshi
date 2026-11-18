export function categoryName(value) {
  const name = cleanText(value, 24, '分类名称');
  if (!name) throw problem(400, '请输入分类名称。');
  return name;
}
export const statuses = ['待制作', '制作中', '已完成', '取消'];

export function problem(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

export function bodyObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw problem(400, '请求格式有误。');
  return value;
}

function cleanText(value, max, field) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > max) throw problem(400, `${field}请控制在 ${max} 字以内。`);
  return value.trim();
}

function validImage(value) {
  const image = cleanText(value, 920_000, '图片');
  if (!image || /^assets\/dish-[1-8]\.webp$/.test(image)) return image;
  if (/^data:image\/(?:jpeg|png|gif|webp);base64,[\w+/=]+$/.test(image)) return image;
  try {
    const url = new URL(image);
    if (image.length <= 2048 && url.protocol === 'https:' && !url.username && !url.password) return image;
  } catch {
    // Other URLs are rejected using the same message.
  }
  throw problem(400, '请上传 JPG、PNG、GIF、WebP 图片，或使用 HTTPS 图片网址。');
}

export function activeValue(value) {
  if (typeof value !== 'boolean') throw problem(400, '请选择是否上架。');
  return value;
}

export function dishInput(payload) {
  const { name, description, category, image, price, active } = bodyObject(payload);
  const cleanName = cleanText(name, 40, '菜品名称');
  if (!cleanName) throw problem(400, '请输入菜品名称。');
  if ((typeof price !== 'number' && typeof price !== 'string') || String(price).trim() === '' || !Number.isFinite(Number(price)) || Number(price) < 0 || Number(price) > 100000) {
    throw problem(400, '请输入 0 到 100000 元之间的参考价格。');
  }
  return { name: cleanName, description: cleanText(description, 200, '菜品描述'), category: categoryName(category), image: validImage(image), price: Math.round(Number(price) * 100) / 100, active: activeValue(active) };
}

export function entityId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw problem(400, '编号格式有误。');
  return id;
}

export function orderInput(payload) {
  const { id, items, note } = bodyObject(payload);
  if (typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)) throw problem(400, '订单编号格式有误。');
  if (!Array.isArray(items) || !items.length || items.length > 50) throw problem(400, '请添加 1 到 50 项菜品。');
  return {
    id,
    items: items.map(item => {
      const { dishId, quantity, note } = bodyObject(item);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw problem(400, '每项菜品须点 1 至 99 份。');
      return { dishId: entityId(dishId), quantity, note: cleanText(note, 500, '单品备注') };
    }),
    note: cleanText(note, 500, '整单备注'),
  };
}

export function orderStatus(value) {
  if (!statuses.includes(value)) throw problem(400, '请选择有效的订单状态。');
  return value;
}
