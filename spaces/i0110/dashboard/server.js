const express = require('express');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const app = express();
const port = process.env.PORT || 8080;

// 启用 JSON 和 URL-encoded 请求解析
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 从环境变量获取 HuggingFace 用户名和对应的 API Token 映射
const userTokenMapping = {};
const usernames = [];
const hfUserConfig = process.env.HF_USER || '';
if (hfUserConfig) {
  hfUserConfig.split(',').forEach(pair => {
    const parts = pair.split(':').map(part => part.trim());
    const username = parts[0];
    const token = parts[1] || '';
    if (username) {
      usernames.push(username);
      if (token) {
        userTokenMapping[username] = token;
      }
    }
  });
}

// 从环境变量获取登录凭据
const ADMIN_USERNAME = process.env.USER_NAME || 'admin';
const ADMIN_PASSWORD = process.env.USER_PASSWORD || 'password';

// 从环境变量获取是否在未登录时展示 private 实例的配置，默认值为 false
const SHOW_PRIVATE = process.env.SHOW_PRIVATE === 'true';
console.log(`SHOW_PRIVATE 配置: ${SHOW_PRIVATE ? '未登录时展示 private 实例' : '未登录时隐藏 private 实例'}`);

// 存储会话 token 的简单内存数据库（生产环境中应使用数据库或 Redis）
const sessions = new Map();
const SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24小时超时

// 缓存管理
class SpaceCache {
  constructor() {
    this.spaces = {};
    this.lastUpdate = null;
  }

  updateAll(spacesData) {
    this.spaces = spacesData.reduce((acc, space) => ({ ...acc, [space.repo_id]: space }), {});
    this.lastUpdate = Date.now();
  }

  getAll() {
    return Object.values(this.spaces);
  }

  isExpired(expireMinutes = 5) {
    if (!this.lastUpdate) return true;
    return (Date.now() - this.lastUpdate) > (expireMinutes * 60 * 1000);
  }

  invalidate() {
    this.lastUpdate = null;
  }
}

const spaceCache = new SpaceCache();

// 用于获取 Spaces 数据的函数，带有重试机制
async function fetchSpacesWithRetry(username, token, maxRetries = 3, retryDelay = 2000) {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      // 仅在 token 存在时添加 Authorization 头
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
      const response = await axios.get(`https://huggingface.co/api/spaces?author=${username}`, {
        headers,
        timeout: 10000 // 设置 10 秒超时
      });
      const spaces = response.data;
      console.log(`获取到 ${spaces.length} 个 Spaces for ${username} (尝试 ${retries + 1}/${maxRetries})，使用 ${token ? 'Token 认证' : '无认证'}`);
      return spaces;
    } catch (error) {
      retries++;
      let errorDetail = error.message;
      if (error.response) {
        errorDetail += `, HTTP Status: ${error.response.status}`;
      } else if (error.request) {
        errorDetail += ', No response received (possible network issue)';
      }
      console.error(`获取 Spaces 列表失败 for ${username} (尝试 ${retries}/${maxRetries}): ${errorDetail}，使用 ${token ? 'Token 认证' : '无认证'}`);
      if (retries < maxRetries) {
        console.log(`等待 ${retryDelay/1000} 秒后重试...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      } else {
        console.error(`达到最大重试次数 (${maxRetries})，放弃重试 for ${username}`);
        return [];
      }
    }
  }
  return [];
}

// 提供静态文件（前端文件）
app.use(express.static(path.join(__dirname, 'public')));

// 提供配置信息的 API 接口
app.get('/api/config', (req, res) => {
  res.json({ usernames: usernames.join(',') });
});

// 登录 API 接口
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    // 生成一个随机 token 作为会话标识
    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + SESSION_TIMEOUT;
    sessions.set(token, { username, expiresAt });
    console.log(`用户 ${username} 登录成功，生成 token: ${token.slice(0, 8)}...`);
    res.json({ success: true, token });
  } else {
    console.log(`用户 ${username} 登录失败，凭据无效`);
    res.status(401).json({ success: false, message: '用户名或密码错误' });
  }
});

// 验证登录状态 API 接口
app.post('/api/verify-token', (req, res) => {
  const { token } = req.body;
  const session = sessions.get(token);
  if (session && session.expiresAt > Date.now()) {
    res.json({ success: true, message: 'Token 有效' });
  } else {
    if (session) {
      sessions.delete(token); // 删除过期的 token
      console.log(`Token ${token.slice(0, 8)}... 已过期，已删除`);
    }
    res.status(401).json({ success: false, message: 'Token 无效或已过期' });
  }
});

// 登出 API 接口
app.post('/api/logout', (req, res) => {
  const { token } = req.body;
  sessions.delete(token);
  console.log(`Token ${token.slice(0, 8)}... 已手动登出`);
  res.json({ success: true, message: '登出成功' });
});

// 中间件：验证请求中的 token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供有效的认证令牌' });
  }
  const token = authHeader.split(' ')[1];
  const session = sessions.get(token);
  if (session && session.expiresAt > Date.now()) {
    req.session = session;
    next();
  } else {
    if (session) {
      sessions.delete(token); // 删除过期的 token
      console.log(`Token ${token.slice(0, 8)}... 已过期，拒绝访问`);
    }
    return res.status(401).json({ error: '认证令牌无效或已过期' });
  }
};

// 获取所有 spaces 列表（包括私有）
app.get('/api/proxy/spaces', async (req, res) => {
  try {
    // 检查是否登录
    let isAuthenticated = false;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const session = sessions.get(token);
      if (session && session.expiresAt > Date.now()) {
        isAuthenticated = true;
        console.log(`用户已登录，Token: ${token.slice(0, 8)}...`);
      } else {
        if (session) {
          sessions.delete(token); // 删除过期的 token
          console.log(`Token ${token.slice(0, 8)}... 已过期，拒绝访问`);
        }
        console.log('用户认证失败，无有效 Token');
      }
    } else {
      console.log('用户未提供认证令牌');
    }

    // 如果缓存为空或已过期，强制重新获取数据
    const cachedSpaces = spaceCache.getAll();
    if (cachedSpaces.length === 0 || spaceCache.isExpired()) {
      console.log(cachedSpaces.length === 0 ? '缓存为空，强制重新获取数据' : '缓存已过期，重新获取数据');
      const allSpaces = [];
      for (const username of usernames) {
        const token = userTokenMapping[username];
        if (!token) {
          console.warn(`用户 ${username} 没有配置 API Token，将尝试无认证访问公开数据`);
        }

        try {
          const spaces = await fetchSpacesWithRetry(username, token);
          for (const space of spaces) {
            try {
              // 仅在 token 存在时添加 Authorization 头
              const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
              const spaceInfoResponse = await axios.get(`https://huggingface.co/api/spaces/${space.id}`, { headers });
              const spaceInfo = spaceInfoResponse.data;
              const spaceRuntime = spaceInfo.runtime || {};

              allSpaces.push({
                repo_id: spaceInfo.id,
                name: spaceInfo.cardData?.title || spaceInfo.id.split('/')[1],
                owner: spaceInfo.author,
                username: username,
                url: `https://${spaceInfo.author}-${spaceInfo.id.split('/')[1]}.hf.space`,
                status: spaceRuntime.stage || 'unknown',
                last_modified: spaceInfo.lastModified || 'unknown',
                created_at: spaceInfo.createdAt || 'unknown',
                sdk: spaceInfo.sdk || 'unknown',
                tags: spaceInfo.tags || [],
                private: spaceInfo.private || false,
                app_port: spaceInfo.cardData?.app_port || 'unknown',
                short_description: spaceInfo.cardData?.short_description || '' // 新增字段，确保为空时返回空字符串
              });
            } catch (error) {
              console.error(`处理 Space ${space.id} 失败:`, error.message, `使用 ${token ? 'Token 认证' : '无认证'}`);
            }
          }
        } catch (error) {
          console.error(`获取 Spaces 列表失败 for ${username}:`, error.message, `使用 ${token ? 'Token 认证' : '无认证'}`);
        }
      }

      allSpaces.sort((a, b) => a.name.localeCompare(b.name));
      spaceCache.updateAll(allSpaces);
      console.log(`总共获取到 ${allSpaces.length} 个 Spaces`);

      const safeSpaces = allSpaces.map(space => {
        const { token, ...safeSpace } = space;
        return safeSpace;
      });

      if (isAuthenticated) {
        console.log('用户已登录，返回所有实例（包括 private）');
        res.json(safeSpaces);
      } else if (SHOW_PRIVATE) {
        console.log('用户未登录，但 SHOW_PRIVATE 为 true，返回所有实例');
        res.json(safeSpaces);
      } else {
        console.log('用户未登录，SHOW_PRIVATE 为 false，过滤 private 实例');
        res.json(safeSpaces.filter(space => !space.private));
      }
    } else {
      console.log('从缓存获取 Spaces 数据');
      const safeSpaces = cachedSpaces.map(space => {
        const { token, ...safeSpace } = space;
        return safeSpace;
      });

      if (isAuthenticated) {
        console.log('用户已登录，返回所有缓存实例（包括 private）');
        return res.json(safeSpaces);
      } else if (SHOW_PRIVATE) {
        console.log('用户未登录，但 SHOW_PRIVATE 为 true，返回所有缓存实例');
        return res.json(safeSpaces);
      } else {
        console.log('用户未登录，SHOW_PRIVATE 为 false，过滤 private 实例');
        return res.json(safeSpaces.filter(space => !space.private));
      }
    }
  } catch (error) {
    console.error(`代理获取 spaces 列表失败:`, error.message);
    res.status(500).json({ error: '获取 spaces 列表失败', details: error.message });
  }
});

// 代理重启 Space（需要认证）
app.post('/api/proxy/restart/:repoId(*)', authenticateToken, async (req, res) => {
  try {
    const { repoId } = req.params;
    console.log(`尝试重启 Space: ${repoId}`);
    const spaces = spaceCache.getAll();
    const space = spaces.find(s => s.repo_id === repoId);
    if (!space || !userTokenMapping[space.username]) {
      console.error(`Space ${repoId} 未找到或无 Token 配置`);
      return res.status(404).json({ error: 'Space 未找到或无 Token 配置' });
    }

    const headers = { 'Authorization': `Bearer ${userTokenMapping[space.username]}`, 'Content-Type': 'application/json' };
    const response = await axios.post(`https://huggingface.co/api/spaces/${repoId}/restart`, {}, { headers });
    console.log(`重启 Space ${repoId} 成功，状态码: ${response.status}`);
    res.json({ success: true, message: `Space ${repoId} 重启成功` });
  } catch (error) {
    console.error(`重启 space 失败 (${req.params.repoId}):`, error.message);
    if (error.response) {
      console.error(`状态码: ${error.response.status}, 响应数据:`, error.response.data);
      res.status(error.response.status || 500).json({ error: '重启 space 失败', details: error.response.data?.message || error.message });
    } else {
      res.status(500).json({ error: '重启 space 失败', details: error.message });
    }
  }
});

// 代理重建 Space（需要认证）
app.post('/api/proxy/rebuild/:repoId(*)', authenticateToken, async (req, res) => {
  try {
    const { repoId } = req.params;
    console.log(`尝试重建 Space: ${repoId}`);
    const spaces = spaceCache.getAll();
    const space = spaces.find(s => s.repo_id === repoId);
    if (!space || !userTokenMapping[space.username]) {
      console.error(`Space ${repoId} 未找到或无 Token 配置`);
      return res.status(404).json({ error: 'Space 未找到或无 Token 配置' });
    }

    const headers = { 'Authorization': `Bearer ${userTokenMapping[space.username]}`, 'Content-Type': 'application/json' };
    // 将 factory_reboot 参数作为查询参数传递，而非请求体
    const response = await axios.post(
      `https://huggingface.co/api/spaces/${repoId}/restart?factory=true`,
      {},
      { headers }
    );
    console.log(`重建 Space ${repoId} 成功，状态码: ${response.status}`);
    res.json({ success: true, message: `Space ${repoId} 重建成功` });
  } catch (error) {
    console.error(`重建 space 失败 (${req.params.repoId}):`, error.message);
    if (error.response) {
      console.error(`状态码: ${error.response.status}, 响应数据:`, error.response.data);
      res.status(error.response.status || 500).json({ error: '重建 space 失败', details: error.response.data?.message || error.message });
    } else {
      res.status(500).json({ error: '重建 space 失败', details: error.message });
    }
  }
});

// 外部 API 服务（类似于 Flask 的 /api/v1）
app.get('/api/v1/info/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== process.env.API_KEY) {
      return res.status(401).json({ error: '无效的 API 密钥' });
    }

    const headers = { 'Authorization': `Bearer ${token}` };
    const userInfoResponse = await axios.get('https://huggingface.co/api/whoami-v2', { headers });
    const username = userInfoResponse.data.name;
    const spacesResponse = await axios.get(`https://huggingface.co/api/spaces?author=${username}`, { headers });
    const spaces = spacesResponse.data;
    const spaceList = [];

    for (const space of spaces) {
      try {
        const spaceInfoResponse = await axios.get(`https://huggingface.co/api/spaces/${space.id}`, { headers });
        spaceList.push(spaceInfoResponse.data.id);
      } catch (error) {
        console.error(`获取 Space 信息失败 (${space.id}):`, error.message);
      }
    }

    res.json({ spaces: spaceList, total: spaceList.length });
  } catch (error) {
    console.error(`获取 spaces 列表失败 (外部 API):`, error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/info/:token/:spaceId(*)', async (req, res) => {
  try {
    const { token, spaceId } = req.params;
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== process.env.API_KEY) {
      return res.status(401).json({ error: '无效的 API 密钥' });
    }

    const headers = { 'Authorization': `Bearer ${token}` };
    const spaceInfoResponse = await axios.get(`https://huggingface.co/api/spaces/${spaceId}`, { headers });
    const spaceInfo = spaceInfoResponse.data;
    const spaceRuntime = spaceInfo.runtime || {};

    res.json({
      id: spaceInfo.id,
      status: spaceRuntime.stage || 'unknown',
      last_modified: spaceInfo.lastModified || null,
      created_at: spaceInfo.createdAt || null,
      sdk: spaceInfo.sdk || 'unknown',
      tags: spaceInfo.tags || [],
      private: spaceInfo.private || false
    });
  } catch (error) {
    console.error(`获取 space 信息失败 (外部 API):`, error.message);
    res.status(error.response?.status || 404).json({ error: error.message });
  }
});

app.post('/api/v1/action/:token/:spaceId(*)/restart', async (req, res) => {
  try {
    const { token, spaceId } = req.params;
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== process.env.API_KEY) {
      return res.status(401).json({ error: '无效的 API 密钥' });
    }

    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    await axios.post(`https://huggingface.co/api/spaces/${spaceId}/restart`, {}, { headers });
    res.json({ success: true, message: `Space ${spaceId} 重启成功` });
  } catch (error) {
    console.error(`重启 space 失败 (外部 API):`, error.message);
    res.status(error.response?.status || 500).json({ success: false, error: error.message });
  }
});

app.post('/api/v1/action/:token/:spaceId(*)/rebuild', async (req, res) => {
  try {
    const { token, spaceId } = req.params;
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== process.env.API_KEY) {
      return res.status(401).json({ error: '无效的 API 密钥' });
    }

    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    console.log(`外部 API 发送重建请求，spaceId: ${spaceId}`);
    // 将 factory_reboot 参数作为查询参数传递，而非请求体
    const response = await axios.post(
      `https://huggingface.co/api/spaces/${spaceId}/restart?factory=true`,
      {},
      { headers }
    );
    console.log(`外部 API 重建 Space ${spaceId} 成功，状态码: ${response.status}`);
    res.json({ success: true, message: `Space ${spaceId} 重建成功` });
  } catch (error) {
    console.error(`重建 space 失败 (外部 API):`, error.message);
    if (error.response) {
      console.error(`状态码: ${error.response.status}, 响应数据:`, error.response.data);
      res.status(error.response.status || 500).json({ success: false, error: error.response.data?.message || error.message });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// 监控数据管理类
class MetricsConnectionManager {
  constructor() {
    this.connections = new Map(); // 存储 HuggingFace API 的监控连接
    this.clients = new Map(); // 存储前端客户端的 SSE 连接
    this.instanceData = new Map(); // 存储每个实例的最新监控数据
  }

  // 建立到 HuggingFace API 的监控连接
  async connectToInstance(repoId, username, token) {
    if (this.connections.has(repoId)) {
      return this.connections.get(repoId);
    }

    const instanceId = repoId.split('/')[1];
    const url = `https://api.hf.space/v1/${username}/${instanceId}/live-metrics/sse`;
    // 仅在 token 存在且非空时添加 Authorization 头
    const headers = token ? {
      'Authorization': `Bearer ${token}`,
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    } : {
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    };

    try {
      const response = await axios({
        method: 'get',
        url,
        headers,
        responseType: 'stream',
        timeout: 10000
      });

      const stream = response.data;
      stream.on('data', (chunk) => {
        const chunkStr = chunk.toString();
        if (chunkStr.includes('event: metric')) {
          const dataMatch = chunkStr.match(/data: (.*)/);
          if (dataMatch && dataMatch[1]) {
            try {
              const metrics = JSON.parse(dataMatch[1]);
              this.instanceData.set(repoId, metrics);
              // 推送给所有订阅了该实例的客户端
              this.clients.forEach((clientRes, clientId) => {
                if (clientRes.subscribedInstances && clientRes.subscribedInstances.includes(repoId)) {
                  clientRes.write(`event: metric\n`);
                  clientRes.write(`data: ${JSON.stringify({ repoId, metrics })}\n\n`);
                }
              });
            } catch (error) {
              console.error(`解析监控数据失败 (${repoId}):`, error.message);
            }
          }
        }
      });

      stream.on('error', (error) => {
        console.error(`监控连接错误 (${repoId}):`, error.message);
        this.connections.delete(repoId);
        this.instanceData.delete(repoId);
      });

      stream.on('end', () => {
        console.log(`监控连接结束 (${repoId})`);
        this.connections.delete(repoId);
        this.instanceData.delete(repoId);
      });

      this.connections.set(repoId, stream);
      console.log(`已建立监控连接 (${repoId})，使用 ${token ? 'Token 认证' : '无认证'}`);
      return stream;
    } catch (error) {
      console.error(`无法连接到监控端点 (${repoId}):`, error.message);
      this.connections.delete(repoId);
      return null;
    }
  }

  // 注册前端客户端的 SSE 连接
  registerClient(clientId, res, subscribedInstances) {
    res.subscribedInstances = subscribedInstances || [];
    this.clients.set(clientId, res);
    console.log(`客户端 ${clientId} 注册，订阅实例: ${res.subscribedInstances.join(', ') || '无'}`);
    
    // 首次连接时，推送已缓存的最新数据
    res.subscribedInstances.forEach(repoId => {
      if (this.instanceData.has(repoId)) {
        const metrics = this.instanceData.get(repoId);
        res.write(`event: metric\n`);
        res.write(`data: ${JSON.stringify({ repoId, metrics })}\n\n`);
      }
    });
  }

  // 客户端断开连接
  unregisterClient(clientId) {
    this.clients.delete(clientId);
    console.log(`客户端 ${clientId} 断开连接`);
    this.cleanupConnections();
  }

  // 更新客户端订阅的实例列表
  updateClientSubscriptions(clientId, subscribedInstances) {
    const clientRes = this.clients.get(clientId);
    if (clientRes) {
      clientRes.subscribedInstances = subscribedInstances || [];
      console.log(`客户端 ${clientId} 更新订阅: ${clientRes.subscribedInstances.join(', ') || '无'}`);
      // 更新后推送最新的缓存数据
      subscribedInstances.forEach(repoId => {
        if (this.instanceData.has(repoId)) {
          const metrics = this.instanceData.get(repoId);
          clientRes.write(`event: metric\n`);
          clientRes.write(`data: ${JSON.stringify({ repoId, metrics })}\n\n`);
        }
      });
    }
    this.cleanupConnections();
  }

  // 清理未被任何客户端订阅的连接
  cleanupConnections() {
    const subscribedRepoIds = new Set();
    this.clients.forEach(clientRes => {
      clientRes.subscribedInstances.forEach(repoId => subscribedRepoIds.add(repoId));
    });

    const toRemove = [];
    this.connections.forEach((stream, repoId) => {
      if (!subscribedRepoIds.has(repoId)) {
        toRemove.push(repoId);
        stream.destroy();
        console.log(`清理未订阅的监控连接 (${repoId})`);
      }
    });

    toRemove.forEach(repoId => {
      this.connections.delete(repoId);
      this.instanceData.delete(repoId);
    });
  }
}

const metricsManager = new MetricsConnectionManager();

// 新增统一监控数据的SSE端点
app.get('/api/proxy/live-metrics-stream', (req, res) => {
  // 设置 SSE 所需的响应头
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  // 生成唯一的客户端ID
  const clientId = crypto.randomBytes(8).toString('hex');
  
  // 获取查询参数中的实例列表和 token
  const instancesParam = req.query.instances || '';
  const token = req.query.token || '';
  const subscribedInstances = instancesParam.split(',').filter(id => id.trim() !== '');

  // 检查登录状态
  let isAuthenticated = false;
  if (token) {
    const session = sessions.get(token);
    if (session && session.expiresAt > Date.now()) {
      isAuthenticated = true;
      console.log(`SSE 用户已登录，Token: ${token.slice(0, 8)}...`);
    } else {
      if (session) {
        sessions.delete(token);
        console.log(`SSE Token ${token.slice(0, 8)}... 已过期，拒绝访问`);
      }
      console.log('SSE 用户认证失败，无有效 Token');
    }
  } else {
    console.log('SSE 用户未提供认证令牌');
  }

  // 注册客户端
  metricsManager.registerClient(clientId, res, subscribedInstances);

  // 根据订阅列表建立监控连接
  const spaces = spaceCache.getAll();
  subscribedInstances.forEach(repoId => {
    const space = spaces.find(s => s.repo_id === repoId);
    if (space) {
      const username = space.username;
      const token = userTokenMapping[username] || '';
      metricsManager.connectToInstance(repoId, username, token);
    }
  });

  // 监听客户端断开连接
  req.on('close', () => {
    metricsManager.unregisterClient(clientId);
    console.log(`客户端 ${clientId} 断开 SSE 连接`);
  });
});

// 新增接口：更新客户端订阅的实例列表
app.post('/api/proxy/update-subscriptions', (req, res) => {
  const { clientId, instances } = req.body;
  if (!clientId || !instances || !Array.isArray(instances)) {
    return res.status(400).json({ error: '缺少 clientId 或 instances 参数' });
  }

  metricsManager.updateClientSubscriptions(clientId, instances);
  // 根据新订阅列表建立监控连接
  const spaces = spaceCache.getAll();
  instances.forEach(repoId => {
    const space = spaces.find(s => s.repo_id === repoId);
    if (space) {
      const username = space.username;
      const token = userTokenMapping[username] || '';
      metricsManager.connectToInstance(repoId, username, token);
    }
  });

  res.json({ success: true, message: '订阅列表已更新' });
});

// 处理其他请求，重定向到 index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 定期清理过期的会话
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt < now) {
      sessions.delete(token);
      console.log(`Token ${token.slice(0, 8)}... 已过期，自动清理`);
    }
  }
}, 60 * 60 * 1000); // 每小时清理一次

// 定时刷新缓存任务
const REFRESH_INTERVAL = 5 * 60 * 1000; // 每 5 分钟检查一次
async function refreshSpacesCachePeriodically() {
  console.log('启动定时刷新缓存任务...');
  setInterval(async () => {
    try {
      const cachedSpaces = spaceCache.getAll();
      if (spaceCache.isExpired() || cachedSpaces.length === 0) {
        console.log('定时任务：缓存已过期或为空，重新获取 Spaces 数据');
        const allSpaces = [];
        for (const username of usernames) {
          const token = userTokenMapping[username];
          if (!token) {
            console.warn(`用户 ${username} 没有配置 API Token，将尝试无认证访问公开数据`);
          }
          try {
            const spaces = await fetchSpacesWithRetry(username, token);
            for (const space of spaces) {
              try {
                const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
                const spaceInfoResponse = await axios.get(`https://huggingface.co/api/spaces/${space.id}`, { headers });
                const spaceInfo = spaceInfoResponse.data;
                const spaceRuntime = spaceInfo.runtime || {};

                allSpaces.push({
                  repo_id: spaceInfo.id,
                  name: spaceInfo.cardData?.title || spaceInfo.id.split('/')[1],
                  owner: spaceInfo.author,
                  username: username,
                  url: `https://${spaceInfo.author}-${spaceInfo.id.split('/')[1]}.hf.space`,
                  status: spaceRuntime.stage || 'unknown',
                  last_modified: spaceInfo.lastModified || 'unknown',
                  created_at: spaceInfo.createdAt || 'unknown',
                  sdk: spaceInfo.sdk || 'unknown',
                  tags: spaceInfo.tags || [],
                  private: spaceInfo.private || false,
                  app_port: spaceInfo.cardData?.app_port || 'unknown',
                  short_description: spaceInfo.cardData?.short_description || '' // 新增字段，确保为空时返回空字符串
                });
              } catch (error) {
                console.error(`处理 Space ${space.id} 失败:`, error.message);
              }
            }
          } catch (error) {
            console.error(`获取 Spaces 列表失败 for ${username}:`, error.message);
          }
        }
        allSpaces.sort((a, b) => a.name.localeCompare(b.name));
        spaceCache.updateAll(allSpaces);
        console.log(`定时任务：总共获取到 ${allSpaces.length} 个 Spaces，缓存已更新`);
      } else {
        console.log('定时任务：缓存有效且不为空，无需更新');
      }
    } catch (error) {
      console.error('定时任务：刷新缓存失败:', error.message);
    }
  }, REFRESH_INTERVAL);
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`User configurations:`, usernames.map(user => `${user}: ${userTokenMapping[user] ? 'Token Configured' : 'No Token'}`).join(', ') || 'None');
  console.log(`Admin login enabled: Username=${ADMIN_USERNAME}, Password=${ADMIN_PASSWORD ? 'Configured' : 'Not Configured'}`);
  refreshSpacesCachePeriodically(); // 启动定时任务
});