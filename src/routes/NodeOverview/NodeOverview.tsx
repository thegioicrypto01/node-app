import { FC, useState } from 'react'
import {
  chakra,
  TabPanels,
  TabPanel,
  Tabs,
  TabList,
  Tab,
} from '@ironfish/ui-kit'
import NodeStatus from './NodeStatus'
import NodePeers from './NodePeers'
import NodeSettings from './NodeSettings'
import NodeResources from './NodeResources'

const NodeOverview: FC = () => {
  const [tabIndex, setTabIndex] = useState(0)
  return (
    <>
      <chakra.h2 mb="1rem">Your Node</chakra.h2>
      <Tabs onChange={index => setTabIndex(index)}>
        <TabList>
          <Tab>
            <h6>Node Overview</h6>
          </Tab>
          <Tab>
            <h6>Node Settings</h6>
          </Tab>
          <Tab>
            <h6>Node Resources</h6>
          </Tab>
        </TabList>
        <TabPanels>
          <TabPanel p="0" pt="2rem">
            <NodeStatus mb="2rem" pauseTracking={tabIndex !== 0} />
            <chakra.h3>Connected Peers</chakra.h3>
            <NodePeers />
          </TabPanel>
          <TabPanel p="0" pt="1rem">
            <NodeSettings />
          </TabPanel>
          <TabPanel p="0" pt="2rem">
            <NodeResources pauseTracking={tabIndex !== 2} />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </>
  )
}

export default NodeOverview
