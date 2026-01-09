export const shouldShowNetworkBanner = (net) => {
  if (!net) return false
  return net.online === false || net.isSlow === true
}
