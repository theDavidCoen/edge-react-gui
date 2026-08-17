const path = require('path')
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')
const {
  wrapWithReanimatedMetroConfig
} = require('react-native-reanimated/metro-config')
const r3Paths = require('r3-hack')

const defaultConfig = getDefaultConfig(__dirname)
const { assetExts, sourceExts } = defaultConfig.resolver

// Shared @scure/base@2.x for btc-signer / micro-packed / multisig PSBT path.
// Without this, Metro keeps a nested 2.x copy for micro-packed while the app
// resolves top-level 1.x — TextEncoder polyfills cannot patch the nested utf8.
const scureBaseV2 = path.resolve(
  __dirname,
  'node_modules/micro-packed/node_modules/@scure/base/index.js'
)

const shouldUseScureBaseV2 = originModulePath => {
  if (originModulePath == null || originModulePath === '') return false
  const normalized = originModulePath.replace(/\\/g, '/')
  return (
    normalized.includes('/micro-packed/') ||
    normalized.includes('/@scure/btc-signer/') ||
    normalized.includes('/@scure/bip32/') ||
    normalized.includes('/@scure/bip39/') ||
    normalized.includes('/util/multisig/') ||
    normalized.includes('/util/ensureTextEncoding')
  )
}

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  transformer: {
    babelTransformerPath: require.resolve(
      'react-native-svg-transformer/react-native'
    )
  },
  resolver: {
    resolveRequest(context, moduleName, platform) {
      if (moduleName === '@scure/base') {
        if (shouldUseScureBaseV2(context.originModulePath)) {
          return { type: 'sourceFile', filePath: scureBaseV2 }
        }
      }

      if (platform === 'android') {
        // Use Reanimated 3 on Android:
        const filePath = r3Paths[moduleName]
        if (filePath != null) {
          return { type: 'sourceFile', filePath }
        }

        // Ensure we aren't missing any reanimated 3 -> 4 mappings:
        if (
          moduleName.startsWith('react-native-reanimated') ||
          moduleName.startsWith('react-native-worklets')
        ) {
          console.log(
            `Could not find "${moduleName}". Please update r3-hack to include it.`
          )
          return { type: 'empty' }
        }
      }

      // Otherwise use the normal Metro resolution:
      return context.resolveRequest(context, moduleName, platform)
    },

    // From react-native-svg-transformer:
    assetExts: assetExts.filter(ext => ext !== 'svg'),
    sourceExts: [...sourceExts, 'svg']
  }
}

module.exports = wrapWithReanimatedMetroConfig(
  mergeConfig(defaultConfig, config)
)
