import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: React.ComponentProps<typeof Ionicons>['name'] = 'alert';

          if (route.name === 'home') {
            iconName = focused ? 'home' : 'home-outline';
          } else if (route.name === 'goals') {
            iconName = focused ? 'golf' : 'golf-outline';
          } else if (route.name === 'agents') {
            iconName = focused ? 'people' : 'people-outline';
          } else if (route.name === 'escalations') {
            iconName = focused ? 'alert-circle' : 'alert-circle-outline';
          } else if (route.name === 'health') {
            iconName = focused ? 'pulse' : 'pulse-outline';
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="goals" options={{ title: 'Goals' }} />
      <Tabs.Screen name="agents" options={{ title: 'Agents' }} />
      <Tabs.Screen name="escalations" options={{ title: 'Escalations' }} />
      <Tabs.Screen name="health" options={{ title: 'Business Health' }} />
    </Tabs>
  );
}
