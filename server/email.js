export function createOrderMailer(config, origin, send = fetch) {
  if (!config) return async () => {};

  return async (event, order, log) => {
    const newOrder = event === 'new-order';
    const recipient = newOrder ? config.chef : config.customer;
    const link = new URL(newOrder ? '/app#kitchen-orders' : '/app#orders', origin);
    const lines = [
      newOrder ? '有一笔新订单，打开小厨房看看吧。' : '你点的菜已经做好，可以开饭啦。',
      ...order.items.map(item => `${item.name} × ${item.quantity}${item.note ? `（${item.note}）` : ''}`),
      ...(order.note ? [`整单备注：${order.note}`] : []),
      '',
      link.href,
    ];

    try {
      const response = await send('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': config.apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: '两人食', email: config.from },
          to: [{ email: recipient }],
          subject: newOrder ? '两人食｜有新订单' : '两人食｜可以开饭了',
          textContent: lines.join('\n'),
        }),
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      if (!response.ok) log.warn({ event, orderId: order.id, status: response.status }, 'Brevo rejected order email');
    } catch (error) {
      log.warn({ event, orderId: order.id, code: error.name }, 'Order email request failed');
    }
  };
}
