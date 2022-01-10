const { Client } = require('ssh2');

const logger = require('../libs/logger');

class Server {
  constructor (server) {
    this.ssh = null;
    this.id = server.id;
    this.server = server;
    this.connected = false;
    this.connect(this.server);
    this.connectFailCount = 0;
  };

  async connect () {
    this.ssh = new Client();
    try {
      await new Promise((resolve, reject) => {
        this.ssh
          .on('ready', () => {
            logger.info('connect ready', this.id);
            this.connected = true;
            resolve(1);
          })
          .on('error', (err) => {
            reject(err);
          })
          .connect(this.server);
      });
      // await this.ssh.connect(this.server);
    } catch (e) {
      logger.error(e);
      this.connectFailCount += 1;
    }
  };

  async destroy () {
    logger.info('Destroying SSH Connect', this.id);
    delete global.runningServer[this.id];
    await this.ssh.end();
    this.ssh = null;
  };

  async run (command) {
    if (this.connectFailCount > 10) {
      throw new Error('多次 SSH 连接失败, 请重新配置此连接');
    }
    if (!this.connected) {
      await this.connect(this.server);
      return await this.run(command);
    }
    this.connectFailCount = 0;
    try {
      const conn = this.ssh;
      const { stderr, stdout } = await new Promise((resolve, reject) => {
        conn.exec(command, (err, stream) => {
          let stderr;
          let stdout;
          if (err) return reject(err);
          stream.on('close', () => {
            resolve({
              stderr,
              stdout
            });
          }).on('data', (data) => {
            stdout = stdout || '';
            stdout += data.toString();
          }).stderr.on('data', (data) => {
            stderr = stderr || '';
            stderr += data.toString();
          });
        }).on('error', (err) => {
          reject(err);
        });
      });
      if (stderr) {
        throw stderr;
      }
      return stdout;
    } catch (e) {
      logger.error(e);
      this.connected = false;
      throw new Error('执行操作遇到错误, 请重试或查看日志');
    }
  };

  async getMemoryUse () {
    const res = await this.run('cat /proc/meminfo');
    const lines = res.split('\n');
    const total = parseInt(lines[0].split(/\s+/)[1]) * 1024;
    const free = parseInt(lines[1].split(/\s+/)[1]) * 1024;
    const buffers = parseInt(lines[3].split(/\s+/)[1]) * 1024;
    const cached = parseInt(lines[4].split(/\s+/)[1]) * 1024;
    return {
      total,
      used: total - free - buffers - cached
    };
  };

  async getCpuUse () {
    const stdout = await this.run('sar -P ALL 1 1');
    const lines = stdout.trim().split('\n');
    const cpuStat = {};
    for (const line of lines) {
      if (!line.startsWith('Average') || line.indexOf('CPU') !== -1) continue;
      const values = line.split(/\s+/);
      const core = {
        idle: parseFloat(values[7])
      };
      cpuStat[values[1]] = core;
    }
    return cpuStat;
  };

  async getNetSpeed () {
    const stdout = await this.run('sar -n DEV 1 1');
    const lines = stdout.trim().split('\n');
    const netSpeed = [];
    for (const line of lines) {
      if (!line.startsWith('Average') || line.indexOf('IFACE') !== -1) continue;
      const values = line.split(/\s+/);
      const _interface = {
        interfaces: values[1],
        rxBytes: parseInt(values[4] * 1024),
        txBytes: parseInt(values[5] * 1024),
        rxPackets: parseInt(values[2]),
        txPackets: parseInt(values[3])
      };
      netSpeed.push(_interface);
    }
    return netSpeed;
  };

  async getLoad () {
    const res = await this.run('cat /proc/loadavg');
    return res.split(/\s+/);
  };

  async getDiskUse () {
    const res = await this.run('df');
    const lines = res.split('\n');
    const disks = [];
    for (const line of lines) {
      if (!line.startsWith('/dev/')) continue;
      const values = line.split(/\s+/);
      const disk = {
        mountPoint: values[5],
        size: parseInt(values[1]) * 1024,
        used: parseInt(values[2]) * 1024,
        left: parseInt(values[3]) * 1024
      };
      disks.push(disk);
    }
    return disks;
  };

  async getVnstat5 () {
    const stdout = await this.run('vnstat --json f 24');
    return JSON.parse(stdout.trim());
  };

  async getVnstatHour () {
    const stdout = await this.run('vnstat --json h 24');
    return JSON.parse(stdout.trim());
  };

  async getVnstatDay () {
    const stdout = await this.run('vnstat --json d 30');
    return JSON.parse(stdout.trim());
  };

  async getVnstatMonth () {
    const stdout = await this.run('vnstat --json m 12');
    return JSON.parse(stdout.trim());
  };
}

module.exports = Server;
