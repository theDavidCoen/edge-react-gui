import { FiatPluginRegionCode } from '../fiatPluginTypes'
import { FiatProviderError, FiatProviderSupportedRegions } from '../fiatProviderTypes'

export const RETURN_URL_SUCCESS = 'https://edge.app/redirect/success/'
export const RETURN_URL_FAIL = 'https://edge.app/redirect/fail/'
export const RETURN_URL_CANCEL = 'https://edge.app/redirect/cancel/'
export const RETURN_URL_PAYMENT = 'https://edge.app/redirect/payment/'

export const NOT_SUCCESS_TOAST_HIDE_MS = 5000

/**
 * @param regionCode
 * @param supportedRegions
 * @returns void if supported, throws otherwise
 */
export const filterRegions = (providerId: string, regionCode: FiatPluginRegionCode, supportedRegions: FiatProviderSupportedRegions): void => {
  const { countryCode, stateProvinceCode } = regionCode
  const countryInfo = supportedRegions[countryCode]
  if (countryInfo == null) return

  const { forStateProvinces, notStateProvinces } = countryInfo

  if (stateProvinceCode != null) {
    if (notStateProvinces != null && notStateProvinces.includes(stateProvinceCode)) {
      throw new FiatProviderError({ providerId, errorType: 'regionRestricted' })
    }
    if (forStateProvinces != null) {
      if (!forStateProvinces.includes(stateProvinceCode)) {
        throw new FiatProviderError({ providerId, errorType: 'regionRestricted' })
      }
    }
  }
}
