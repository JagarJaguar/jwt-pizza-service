const os = require('os');
const config = require('./config.js');

let requestLatencyTotalMs = 0;
let requestLatencyCount = 0;
const requests = {}
const authAttempts ={ success: 0, failure: 0 };
const activeUsers = new Map();
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

const pizzas = {sold: 0, failures: 0, revenue: 0};
let pizzaLatencyTotalMs = 0;
let pizzaLatencyCount = 0;

function requestTracker(req, res, next) {
  const start = Date.now();
  const method = req.method;
  const path = req.path;

  res.on('finish', () => {
    requests[method] = (requests[method] || 0) + 1;
    requestLatencyTotalMs += Date.now() - start;
    requestLatencyCount++;
    trackAuth(method, path, res.statusCode);
    trackActiveUser(req, method, path, res.statusCode);
  });

  next();
}

function httpMetrics() {
  const metrics = Object.keys(requests).map((method) => createMetric('http_requests', requests[method], '1', 'sum', 'asInt', { method }));
  if (requestLatencyCount > 0) {
    metrics.push(createMetric('endpoint_latency', requestLatencyTotalMs / requestLatencyCount, 'ms', 'gauge', 'asDouble', {}));
    requestLatencyTotalMs = 0;
    requestLatencyCount = 0;
  }
  return metrics;
}

function trackAuth(method, path, statusCode) {
  if (method === 'PUT' && path === '/api/auth') {
    if (statusCode === 200) {
      authAttempts.success++;
    } else {
      authAttempts.failure++;
    }
  }
}

function authMetrics() {
  return [createMetric('auth_attempts', authAttempts.success, '1', 'sum', 'asInt', { result: 'success' }),
    createMetric('auth_attempts', authAttempts.failure, '1', 'sum', 'asInt', { result: 'failure' }),];
}

function trackActiveUser(req, method, path, statusCode) {
  if (path === '/api/auth' && statusCode === 200) {
    if (method === 'DELETE') {
      activeUsers.delete(req.user.email);
    } else {
      activeUsers.set(req.body.email, Date.now());
    }
  } else if (req.user) {
    activeUsers.set(req.user.email, Date.now());
  }
};

function userMetrics() {
  const now = Date.now();
  activeUsers.forEach((lastSeen, email) => {
    if (now - lastSeen> ACTIVE_WINDOW_MS) {
      activeUsers.delete(email);
    }
  });
  return [createMetric('active_users', activeUsers.size, '{users}', 'gauge', 'asInt', {})];
}

function pizzaPurchase(success, latency, price, count) {
  if (success) {
    pizzas.sold += count;
    pizzas.revenue += price;
  } else {
    pizzas.failures++;
  }
  pizzaLatencyTotalMs += latency;
  pizzaLatencyCount++;
}

function purchaseMetrics() {
  const metrics = [
    createMetric('pizzas_sold', pizzas.sold, '1', 'sum', 'asInt', {}),
    createMetric('pizza_failures', pizzas.failures, '1', 'sum', 'asInt', {}),
    createMetric('pizza_revenue', pizzas.revenue, '1', 'sum', 'asDouble', {}),
  ];
  if (pizzaLatencyCount > 0) {
    metrics.push(createMetric('pizza_latency', pizzaLatencyTotalMs / pizzaLatencyCount, 'ms', 'gauge', 'asDouble', {}));
    pizzaLatencyTotalMs = 0;
    pizzaLatencyCount = 0;
  }
  return metrics;
}

function systemMetrics() {
  const cpu = (os.loadavg()[0] / os.cpus().length) * 100;
  const memory = ((os.totalmem() - os.freemem()) / os.totalmem()) * 100;
  return [createMetric('cpu', cpu, '%', 'gauge', 'asDouble', {}), createMetric('memory', memory, '%', 'gauge', 'asDouble', {})];
}

function createMetric(metricName, metricValue, metricUnit, metricType, valueType, attributes) {
  attributes = { ...attributes, source: config.metrics.source };

  const metric = {
    name: metricName,
    unit: metricUnit,
    [metricType]: {
      dataPoints: [
        {
          [valueType]: metricValue,
          timeUnixNano: Date.now() * 1000000,
          attributes: [],
        },
      ],
    },
  };

  Object.keys(attributes).forEach((key) => {
    metric[metricType].dataPoints[0].attributes.push({
      key: key,
      value: { stringValue: attributes[key] },
    });
  });

  if (metricType === 'sum') {
    metric[metricType].aggregationTemporality = 'AGGREGATION_TEMPORALITY_CUMULATIVE';
    metric[metricType].isMonotonic = true;
  }

  return metric;
}

class OtelMetricBuilder {
  constructor() {
    this.metrics = [];
  }

  add(metrics) {
    this.metrics.push(...metrics);
  }

  sendToGrafana() {
    const body = { resourceMetrics: [{ scopeMetrics: [{ metrics: this.metrics }] }] };

    fetch(config.metrics.endpointUrl, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { Authorization: `Bearer ${config.metrics.accountId}:${config.metrics.apiKey}`, 'Content-Type': 'application/json' },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP status: ${response.status}`);
        }
      })
      .catch((error) => {
        console.error('Error pushing metrics:', error);
      });
  }
}


function sendMetricsPeriodically(period) {
  const timer = setInterval(() => {
    try {
      const metrics = new OtelMetricBuilder();
      metrics.add(httpMetrics());
      metrics.add(systemMetrics());
      metrics.add(userMetrics());
      metrics.add(purchaseMetrics());
      metrics.add(authMetrics());

      metrics.sendToGrafana();
    } catch (error) {
      console.log('Error sending metrics', error);
    }
  }, period);

  timer.unref();
}

sendMetricsPeriodically(10000);

module.exports = { requestTracker, pizzaPurchase };