import replace from 'replace-in-file'

const replaceOptions = {
  files: 'src/**/*.ts',
  from: /@azure/g,
  to: 'azure',
}

try {
  const azureResults = await replace(replaceOptions)
  console.log('Replacement results:', {
    replaceFileCount: azureResults.length,
  })
} catch (error) {
  console.error('Error occurred:', error)
}
