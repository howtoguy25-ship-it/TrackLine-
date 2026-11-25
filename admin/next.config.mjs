/** Static export: the dashboard is plain files on Firebase Hosting (site "admin"); every
 *  privileged read and write goes through the role-checked Cloud Functions. */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};
export default nextConfig;
