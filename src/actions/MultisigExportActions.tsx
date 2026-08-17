import * as React from 'react'

import { RawTextModal } from '../components/modals/RawTextModal'
import { Airship, showError } from '../components/services/AirshipInstance'
import { lstrings } from '../locales/strings'
import type { ThunkAction } from '../types/reduxTypes'
import {
  buildMultisigBsmsText,
  buildMultisigExportFilename,
  buildMultisigExportText
} from '../util/multisig/exportInfo'
import { getMultisigProposalByWalletId } from '../util/multisig/store'
import type { MultisigProposal } from '../util/multisig/types'
import { validatePassword } from './AccountActions'

const promptMultisigExportPassword = async (
  dispatch: (action: ReturnType<typeof validatePassword>) => Promise<unknown>
): Promise<boolean> =>
  await dispatch(
    validatePassword({
      title: lstrings.multisig_export_recovery_password_title,
      warningMessage: lstrings.multisig_export_recovery_password_message,
      submitLabel: lstrings.multisig_export_recovery
    })
  ).then(result => result != null)

export const showMultisigRecoveryExportForProposal = (
  proposal: MultisigProposal
): ThunkAction<Promise<void>> => {
  return async dispatch => {
    if (proposal.status !== 'complete') {
      showError(new Error(lstrings.multisig_export_unavailable))
      return
    }
    const passwordValid = await promptMultisigExportPassword(dispatch)
    if (!passwordValid) return

    const body = buildMultisigExportText(proposal)
    await Airship.show(bridge => (
      <RawTextModal
        bridge={bridge}
        body={body}
        title={lstrings.multisig_export_recovery_title}
        shareFiles={[
          {
            filename: buildMultisigExportFilename(proposal, 'txt'),
            contents: body
          },
          {
            filename: buildMultisigExportFilename(proposal, 'bsms'),
            contents: buildMultisigBsmsText(proposal)
          }
        ]}
      />
    ))
  }
}

export const showMultisigRecoveryExport = (
  walletId: string
): ThunkAction<Promise<void>> => {
  return async dispatch => {
    const proposal = getMultisigProposalByWalletId(walletId)
    if (proposal == null) {
      showError(new Error(lstrings.multisig_export_unavailable))
      return
    }
    await dispatch(showMultisigRecoveryExportForProposal(proposal))
  }
}
