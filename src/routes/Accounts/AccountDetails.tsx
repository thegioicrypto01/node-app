import { FC } from 'react'
import {
  Box,
  Flex,
  chakra,
  CopyValueToClipboard,
  NAMED_COLORS,
  TabPanels,
  TabPanel,
  Tabs,
  TabList,
  Tab,
} from '@ironfish/ui-kit'
import { useLocation } from 'react-router-dom'
import { ROUTES } from '..'
import { truncateHash } from 'Utils/hash'
import LocationStateProps from 'Types/LocationState'
import AccountOverview from './AccountTabs/Overview'
import AccountKeys from './AccountTabs/Keys'
import BackButtonLink from 'Components/BackButtonLink'
import useAccount from 'Hooks/accounts/useAccount'
import AccountSettings from './AccountTabs/Settings'

const AccountDetails: FC = () => {
  const location = useLocation()
  const { accountId } = location.state as LocationStateProps
  const {
    data: account,
    loaded,
    actions: { exportAccount, updateAccount, deleteAccount },
  } = useAccount(accountId)
  return (
    <Flex flexDirection="column" pb="0" bg="transparent" w="100%" h="100%">
      <BackButtonLink
        mb="1rem"
        to={ROUTES.ACCOUNTS}
        label={'Back to all accounts'}
      />
      {loaded && (
        <>
          <Flex alignItems="end" mb="0.5rem">
            <chakra.h2 mr="1rem">{account.name}</chakra.h2>
            <CopyValueToClipboard
              label={truncateHash(account?.publicAddress, 3)}
              labelProps={{
                as: 'h5',
              }}
              value={account.publicAddress}
              copyTooltipText="Copy to clipboard"
              copiedTooltipText="Copied"
              containerProps={{
                pb: '0.45rem',
                color: NAMED_COLORS.GREY,
                _dark: {
                  color: NAMED_COLORS.PALE_GREY,
                },
              }}
            />
          </Flex>
          <Tabs flexGrow={1} display="flex" flexDirection="column">
            <TabList>
              <Tab>
                <chakra.h6>Account Overview</chakra.h6>
              </Tab>
              <Tab>
                <chakra.h6>Keys</chakra.h6>
              </Tab>
              <Tab>
                <chakra.h6>Settings</chakra.h6>
              </Tab>
            </TabList>
            <TabPanels flexGrow={1} display="flex" alignItems="stretch">
              <TabPanel p="0" flexGrow={1} display="flex" alignItems="stretch">
                <AccountOverview account={account} />
              </TabPanel>
              <TabPanel p="0" pt="2rem">
                <AccountKeys account={account} exportAccount={exportAccount} />
              </TabPanel>
              <TabPanel p="0" pt="2rem">
                <AccountSettings
                  account={account}
                  updateAccount={updateAccount}
                  deleteAccount={deleteAccount}
                />
              </TabPanel>
            </TabPanels>
          </Tabs>
        </>
      )}
    </Flex>
  )
}

export default AccountDetails
