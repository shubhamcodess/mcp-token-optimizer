import { render } from 'preact'
import { App } from './App'
import { initToken } from './api'
import './styles.css'

initToken()
// `mto ui` opened while the dashboard is already open only changes the hash: pick up the new token and reload
addEventListener('hashchange', () => {
  if (/[#&]t=/.test(location.hash)) {
    initToken()
    location.reload()
  }
})
render(<App />, document.getElementById('app')!)
