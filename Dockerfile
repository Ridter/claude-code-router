FROM node:20-alpine

# 设置工作目录
WORKDIR /app

# 只复制构建产物
COPY dist/ ./dist/

# 创建配置目录（volume 挂载点）
RUN mkdir -p /root/.claude-code-router /root/.claude/projects

# 暴露端口
EXPOSE 3456

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3456/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }).on('error', () => { process.exit(1); });"

# 启动脚本：清理旧的 PID 文件后再启动
CMD sh -c "rm -f /root/.claude-code-router/.claude-code-router.pid && node dist/cli.js start"
