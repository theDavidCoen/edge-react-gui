// @flow

import React, { Component } from 'react'
import { StyleSheet } from 'react-native'
import { TextField } from 'react-native-material-textfield'

import { THEME } from '../../../../theme/variables/airbitz.js'

const rawStyles = {
  pinInput: {}
}
const styles = StyleSheet.create(rawStyles)

const DEFAULTS = {
  maxLength: 4,
  secureTextEntry: true,
  tintColor: THEME.COLORS.WHITE,
  baseColor: THEME.COLORS.WHITE,
  textColor: THEME.COLORS.WHITE,
  autoFocus: false,
  label: '',
  keyboardType: 'numeric'
}

export type Props = {
  style?: StyleSheet.Styles,
  onChangePin: (pin: string) => mixed
}
export class PinInput extends Component<Props> {
  textField: any

  render () {
    const { onChangePin, style, ...props } = this.props
    return <TextField ref={ref => (this.textField = ref)} onChangeText={onChangePin} style={[styles.pinInput, style]} {...DEFAULTS} {...props} />
  }

  blur = () => {
    this.textField.blur()
  }

  focus = () => {
    this.textField.focus()
  }
}

export default PinInput
