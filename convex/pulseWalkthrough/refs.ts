import {makeFunctionReference} from 'convex/server';
// Explicit references permit offline type checking without remote code generation.
export const ref=(name:string)=>makeFunctionReference<any>(`pulseWalkthrough/${name}`);
