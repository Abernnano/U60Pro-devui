# Beta 构建说明

从项目根目录运行：

    python -X utf8 ./build-tools/test-beta.py
    python -X utf8 ./build-tools/test-install.py
    python -X utf8 ./local-assets/u60pro-screen-ui-v1.0.0/runtime-src/scripts/build-windows.py
    python -X utf8 ./build-tools/package-beta.py

依赖已在 local-assets/screen-build 中：Zig 0.14.1、FreeType 2.13.3、litehtml 0.10；构建不联网下载。Linux 回归测试使用现有 docker-desktop WSL，仅在独立 /tmp/devui-* 目录运行测试夹具，不连接路由器。

source-patch 的 src、include、scripts、tests 覆盖 runtime-src 对应目录，ui 覆盖 UI 目录。source.tar.gz 内 beta-build-tools 对应项目 build-tools；还包含信号评分参考算法 fixture。回归通过后重新编译，再打包。

编译缓存包含头文件摘要。打包校验程序功能标记、全部模板 token、页面链接目标、UTF-8 与问号乱码，复制最新渲染器并核对其 SHA-256；缺失或陈旧产物会中止打包。
