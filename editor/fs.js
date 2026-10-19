// What the IDE (web/index.html) uses for its project's files, as one module (build.py bundles it with
// esbuild): ZenFS, a node-like fs over IndexedDB (the project kept in the browser) or a
// directory handle (a real folder, File System Access), and fflate for zip in and out.
export { configure, mount, umount, resolveMountConfig, fs } from "@zenfs/core";
export { IndexedDB, WebAccess } from "@zenfs/dom";
export { unzipSync, zipSync } from "fflate";
