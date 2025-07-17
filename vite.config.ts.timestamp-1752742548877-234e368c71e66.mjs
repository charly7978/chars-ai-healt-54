// vite.config.ts
import { defineConfig } from "file:///C:/Users/nispero/OneDrive/Documentos/GitHub/MyApplication3/chars-ai-healt-48/node_modules/vite/dist/node/index.js";
import react from "file:///C:/Users/nispero/OneDrive/Documentos/GitHub/MyApplication3/chars-ai-healt-48/node_modules/@vitejs/plugin-react-swc/index.mjs";
import path from "path";
import { componentTagger } from "file:///C:/Users/nispero/OneDrive/Documentos/GitHub/MyApplication3/chars-ai-healt-48/node_modules/lovable-tagger/dist/index.js";
var __vite_injected_original_dirname = "C:\\Users\\nispero\\OneDrive\\Documentos\\GitHub\\MyApplication3\\chars-ai-healt-48";
var vite_config_default = defineConfig(({ mode }) => {
  const isProduction = mode === "production";
  return {
    server: {
      host: "::",
      port: 8080
    },
    plugins: [
      react(),
      mode === "development" && componentTagger()
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__vite_injected_original_dirname, "./src")
      }
    },
    build: {
      outDir: "dist",
      assetsDir: "assets",
      sourcemap: !isProduction,
      minify: isProduction ? "terser" : false,
      chunkSizeWarningLimit: 1e3,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ["react", "react-dom", "react-router-dom"]
          }
        }
      },
      terserOptions: {
        compress: {
          drop_console: isProduction,
          drop_debugger: isProduction
        }
      }
    },
    optimizeDeps: {
      include: ["react", "react-dom"],
      esbuildOptions: {
        // Enable esbuild polyfill for Node.js globals
        define: {
          global: "globalThis"
        }
      }
    },
    define: {
      "process.env": {},
      "global": "window"
    }
  };
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxuaXNwZXJvXFxcXE9uZURyaXZlXFxcXERvY3VtZW50b3NcXFxcR2l0SHViXFxcXE15QXBwbGljYXRpb24zXFxcXGNoYXJzLWFpLWhlYWx0LTQ4XCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxuaXNwZXJvXFxcXE9uZURyaXZlXFxcXERvY3VtZW50b3NcXFxcR2l0SHViXFxcXE15QXBwbGljYXRpb24zXFxcXGNoYXJzLWFpLWhlYWx0LTQ4XFxcXHZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9DOi9Vc2Vycy9uaXNwZXJvL09uZURyaXZlL0RvY3VtZW50b3MvR2l0SHViL015QXBwbGljYXRpb24zL2NoYXJzLWFpLWhlYWx0LTQ4L3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSBcInZpdGVcIjtcclxuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdC1zd2NcIjtcclxuaW1wb3J0IHBhdGggZnJvbSBcInBhdGhcIjtcclxuaW1wb3J0IHsgY29tcG9uZW50VGFnZ2VyIH0gZnJvbSBcImxvdmFibGUtdGFnZ2VyXCI7XHJcblxyXG4vLyBodHRwczovL3ZpdGVqcy5kZXYvY29uZmlnL1xyXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoKHsgbW9kZSB9KSA9PiB7XHJcbiAgY29uc3QgaXNQcm9kdWN0aW9uID0gbW9kZSA9PT0gJ3Byb2R1Y3Rpb24nO1xyXG4gIFxyXG4gIHJldHVybiB7XHJcbiAgICBzZXJ2ZXI6IHtcclxuICAgICAgaG9zdDogXCI6OlwiLFxyXG4gICAgICBwb3J0OiA4MDgwLFxyXG4gICAgfSxcclxuICAgIHBsdWdpbnM6IFtcclxuICAgICAgcmVhY3QoKSxcclxuICAgICAgbW9kZSA9PT0gJ2RldmVsb3BtZW50JyAmJiBjb21wb25lbnRUYWdnZXIoKSxcclxuICAgIF0uZmlsdGVyKEJvb2xlYW4pLFxyXG4gICAgcmVzb2x2ZToge1xyXG4gICAgICBhbGlhczoge1xyXG4gICAgICAgIFwiQFwiOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4vc3JjXCIpLFxyXG4gICAgICB9LFxyXG4gICAgfSxcclxuICAgIGJ1aWxkOiB7XHJcbiAgICAgIG91dERpcjogJ2Rpc3QnLFxyXG4gICAgICBhc3NldHNEaXI6ICdhc3NldHMnLFxyXG4gICAgICBzb3VyY2VtYXA6ICFpc1Byb2R1Y3Rpb24sXHJcbiAgICAgIG1pbmlmeTogaXNQcm9kdWN0aW9uID8gJ3RlcnNlcicgOiBmYWxzZSxcclxuICAgICAgY2h1bmtTaXplV2FybmluZ0xpbWl0OiAxMDAwLFxyXG4gICAgICByb2xsdXBPcHRpb25zOiB7XHJcbiAgICAgICAgb3V0cHV0OiB7XHJcbiAgICAgICAgICBtYW51YWxDaHVua3M6IHtcclxuICAgICAgICAgICAgdmVuZG9yOiBbJ3JlYWN0JywgJ3JlYWN0LWRvbScsICdyZWFjdC1yb3V0ZXItZG9tJ10sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0sXHJcbiAgICAgIHRlcnNlck9wdGlvbnM6IHtcclxuICAgICAgICBjb21wcmVzczoge1xyXG4gICAgICAgICAgZHJvcF9jb25zb2xlOiBpc1Byb2R1Y3Rpb24sXHJcbiAgICAgICAgICBkcm9wX2RlYnVnZ2VyOiBpc1Byb2R1Y3Rpb24sXHJcbiAgICAgICAgfSxcclxuICAgICAgfSxcclxuICAgIH0sXHJcbiAgICBvcHRpbWl6ZURlcHM6IHtcclxuICAgICAgaW5jbHVkZTogWydyZWFjdCcsICdyZWFjdC1kb20nXSxcclxuICAgICAgZXNidWlsZE9wdGlvbnM6IHtcclxuICAgICAgICAvLyBFbmFibGUgZXNidWlsZCBwb2x5ZmlsbCBmb3IgTm9kZS5qcyBnbG9iYWxzXHJcbiAgICAgICAgZGVmaW5lOiB7XHJcbiAgICAgICAgICBnbG9iYWw6ICdnbG9iYWxUaGlzJyxcclxuICAgICAgICB9LFxyXG4gICAgICB9LFxyXG4gICAgfSxcclxuICAgIGRlZmluZToge1xyXG4gICAgICAncHJvY2Vzcy5lbnYnOiB7fSxcclxuICAgICAgJ2dsb2JhbCc6ICd3aW5kb3cnLFxyXG4gICAgfSxcclxuICB9O1xyXG59KTtcclxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFzYSxTQUFTLG9CQUFvQjtBQUNuYyxPQUFPLFdBQVc7QUFDbEIsT0FBTyxVQUFVO0FBQ2pCLFNBQVMsdUJBQXVCO0FBSGhDLElBQU0sbUNBQW1DO0FBTXpDLElBQU8sc0JBQVEsYUFBYSxDQUFDLEVBQUUsS0FBSyxNQUFNO0FBQ3hDLFFBQU0sZUFBZSxTQUFTO0FBRTlCLFNBQU87QUFBQSxJQUNMLFFBQVE7QUFBQSxNQUNOLE1BQU07QUFBQSxNQUNOLE1BQU07QUFBQSxJQUNSO0FBQUEsSUFDQSxTQUFTO0FBQUEsTUFDUCxNQUFNO0FBQUEsTUFDTixTQUFTLGlCQUFpQixnQkFBZ0I7QUFBQSxJQUM1QyxFQUFFLE9BQU8sT0FBTztBQUFBLElBQ2hCLFNBQVM7QUFBQSxNQUNQLE9BQU87QUFBQSxRQUNMLEtBQUssS0FBSyxRQUFRLGtDQUFXLE9BQU87QUFBQSxNQUN0QztBQUFBLElBQ0Y7QUFBQSxJQUNBLE9BQU87QUFBQSxNQUNMLFFBQVE7QUFBQSxNQUNSLFdBQVc7QUFBQSxNQUNYLFdBQVcsQ0FBQztBQUFBLE1BQ1osUUFBUSxlQUFlLFdBQVc7QUFBQSxNQUNsQyx1QkFBdUI7QUFBQSxNQUN2QixlQUFlO0FBQUEsUUFDYixRQUFRO0FBQUEsVUFDTixjQUFjO0FBQUEsWUFDWixRQUFRLENBQUMsU0FBUyxhQUFhLGtCQUFrQjtBQUFBLFVBQ25EO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFBQSxNQUNBLGVBQWU7QUFBQSxRQUNiLFVBQVU7QUFBQSxVQUNSLGNBQWM7QUFBQSxVQUNkLGVBQWU7QUFBQSxRQUNqQjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsSUFDQSxjQUFjO0FBQUEsTUFDWixTQUFTLENBQUMsU0FBUyxXQUFXO0FBQUEsTUFDOUIsZ0JBQWdCO0FBQUE7QUFBQSxRQUVkLFFBQVE7QUFBQSxVQUNOLFFBQVE7QUFBQSxRQUNWO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxJQUNBLFFBQVE7QUFBQSxNQUNOLGVBQWUsQ0FBQztBQUFBLE1BQ2hCLFVBQVU7QUFBQSxJQUNaO0FBQUEsRUFDRjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
