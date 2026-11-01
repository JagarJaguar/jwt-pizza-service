const os = require('os');
const config = require('./config.js');

let requestLatencyTotalMs = 0;
let requestLatencyCount = 0;
const requests = {}

function requestTracker(req, res, next) {
  const start = Date.now();
  const method = req.method;

  res.on('finish', () => {
    requests[method] = (requests[method] || 0) + 1;
    requestLatencyTotalMs += Date.now() - start;
    requestLatencyCount++;
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
      // metrics.add(userMetrics());
      // metrics.add(purchaseMetrics());
      // metrics.add(authMetrics());

      metrics.sendToGrafana();
    } catch (error) {
      console.log('Error sending metrics', error);
    }
  }, period);

  timer.unref();
}

sendMetricsPeriodically(10000);

module.exports = { requestTracker };