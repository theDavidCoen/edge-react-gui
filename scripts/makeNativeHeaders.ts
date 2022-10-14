import fs from 'fs'
import path from 'path'

function makeNativeHeaders() {
  let apiKey = 'Error: Set up env.json & re-run scrips/makeNativeHeaders.js'
  try {
    apiKey = require('../env.json').AIRBITZ_API_KEY
  } catch (e) {
    console.log(apiKey)
  }

  const iosPath = path.join(__dirname, '../ios/edge/edgeApiKey.h')
  const iosSource = `/* auto-generated by scrips/makeNativeHeaders.js */
#ifndef EDGE_API_KEY_H_INCLUDED
#define EDGE_API_KEY_H_INCLUDED

#define EDGE_API_KEY "${apiKey}"

#endif
`
  fs.writeFileSync(iosPath, iosSource)

  const androidPath = path.join(__dirname, '../android/app/src/main/java/co/edgesecure/app/EdgeApiKey.java')
  const androidSource = `/* auto-generated by scrips/makeNativeHeaders.js */
package co.edgesecure.app;

public class EdgeApiKey {
  public static final String apiKey = "${apiKey}";
}
`
  fs.writeFileSync(androidPath, androidSource)
}

try {
  makeNativeHeaders()
} catch (e) {
  console.log(e)
}