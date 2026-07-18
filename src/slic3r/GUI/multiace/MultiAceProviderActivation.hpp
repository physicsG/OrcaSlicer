#ifndef slic3r_MultiAceProviderActivation_hpp_
#define slic3r_MultiAceProviderActivation_hpp_

#include "../DeviceManager.hpp"
#include "MultiAceProviderConfig.hpp"

#include <utility>

namespace Slic3r::MultiAce {

inline MultiAceMachineBinding& activate_multiace_web_provider(DeviceManager&                    device_manager,
                                                              MachineObject&                    machine,
                                                              const ProviderActivationConfig&   config,
                                                              DeviceManager::MultiAceDispatcher dispatcher = {})
{
    auto provider = create_started_multiace_web_provider(config);
    try {
        return device_manager.attach_multiace_provider(machine, provider, std::move(dispatcher));
    } catch (...) {
        provider->stop();
        throw;
    }
}

} // namespace Slic3r::MultiAce

#endif // slic3r_MultiAceProviderActivation_hpp_
