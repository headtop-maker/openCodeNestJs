module.exports = {
  apps: [{
    name: 'tunnel-server',
    script: 'dist/main.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
    },
  }],
};
